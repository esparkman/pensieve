import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
// Configuration limits
export const LIMITS = {
    MAX_DECISIONS: 1000,
    MAX_DISCOVERIES: 500,
    MAX_ENTITIES: 200,
    MAX_QUESTIONS: 100,
    MAX_SESSIONS: 100,
    SESSION_RETENTION_DAYS: 90,
    MAX_FIELD_LENGTH: 10000, // 10KB per field
};
export class MemoryDatabase {
    db;
    projectPath;
    dbPath;
    constructor(projectPath) {
        // Use provided path, or detect from current directory, or use home
        this.projectPath = projectPath || process.cwd();
        this.dbPath = this.getDbPath();
        // Ensure directory exists
        const dbDir = dirname(this.dbPath);
        if (!existsSync(dbDir)) {
            mkdirSync(dbDir, { recursive: true });
        }
        this.db = this.openDatabase();
        this.initSchema();
    }
    openDatabase() {
        // Always try to open in read-write mode
        // If file doesn't exist, it will be created
        try {
            return new Database(this.dbPath, { fileMustExist: false });
        }
        catch (error) {
            console.error(`[Pensieve] Failed to open database: ${error}`);
            throw error;
        }
    }
    /**
     * Check if the database is writable and reconnect if needed
     */
    ensureWritable() {
        try {
            // Test write capability
            this.db.exec('SELECT 1');
            this.db.prepare('CREATE TABLE IF NOT EXISTS _pensieve_health_check (id INTEGER)').run();
            return true;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('readonly')) {
                console.error('[Pensieve] Database is read-only, attempting reconnection...');
                try {
                    this.db.close();
                    this.db = this.openDatabase();
                    console.error('[Pensieve] Reconnected successfully');
                    return true;
                }
                catch (reconnectError) {
                    console.error(`[Pensieve] Reconnection failed: ${reconnectError}`);
                    return false;
                }
            }
            return false;
        }
    }
    getDbPath() {
        // Check for explicit database path override
        const envPath = process.env.PENSIEVE_DB_PATH;
        if (envPath) {
            console.error(`[Pensieve] Using database from PENSIEVE_DB_PATH: ${envPath}`);
            return envPath;
        }
        // Check for explicit project path (recommended for MCP server usage)
        // This should be set in the MCP server config to ensure deterministic behavior
        const projectDir = process.env.PENSIEVE_PROJECT_DIR;
        if (projectDir) {
            const projectPath = join(projectDir, '.pensieve', 'memory.sqlite');
            console.error(`[Pensieve] Using project database from PENSIEVE_PROJECT_DIR: ${projectPath}`);
            return projectPath;
        }
        // Fallback: Try project-local first, then fall back to home directory
        // WARNING: Using process.cwd() is unreliable in MCP server context
        const localPath = join(this.projectPath, '.pensieve', 'memory.sqlite');
        const globalPath = join(homedir(), '.claude-pensieve', 'memory.sqlite');
        // If local .pensieve directory exists or we're in a git repo, use local
        if (existsSync(join(this.projectPath, '.pensieve')) ||
            existsSync(join(this.projectPath, '.git'))) {
            console.error(`[Pensieve] WARNING: Using cwd-based path (unreliable): ${localPath}`);
            console.error(`[Pensieve] Set PENSIEVE_PROJECT_DIR for deterministic behavior`);
            return localPath;
        }
        console.error(`[Pensieve] Using global database: ${globalPath}`);
        return globalPath;
    }
    /**
     * Truncate a string to the maximum field length
     */
    truncateField(value, fieldName) {
        if (!value)
            return null;
        if (value.length <= LIMITS.MAX_FIELD_LENGTH)
            return value;
        console.error(`[Pensieve] Warning: Truncating ${fieldName || 'field'} from ${value.length} to ${LIMITS.MAX_FIELD_LENGTH} chars`);
        return value.substring(0, LIMITS.MAX_FIELD_LENGTH) + '... [truncated]';
    }
    /**
     * Prune old entries when limits are exceeded
     */
    pruneIfNeeded() {
        // Prune old sessions beyond retention period
        this.db.prepare(`
      DELETE FROM sessions
      WHERE ended_at IS NOT NULL
      AND datetime(ended_at) < datetime('now', '-${LIMITS.SESSION_RETENTION_DAYS} days')
    `).run();
        // Prune excess decisions (keep most recent)
        const decisionCount = this.db.prepare('SELECT COUNT(*) as count FROM decisions').get().count;
        if (decisionCount > LIMITS.MAX_DECISIONS) {
            const excess = decisionCount - LIMITS.MAX_DECISIONS;
            this.db.prepare(`
        DELETE FROM decisions WHERE id IN (
          SELECT id FROM decisions ORDER BY decided_at ASC LIMIT ?
        )
      `).run(excess);
            console.error(`[Pensieve] Pruned ${excess} old decisions`);
        }
        // Prune excess discoveries
        const discoveryCount = this.db.prepare('SELECT COUNT(*) as count FROM discoveries').get().count;
        if (discoveryCount > LIMITS.MAX_DISCOVERIES) {
            const excess = discoveryCount - LIMITS.MAX_DISCOVERIES;
            this.db.prepare(`
        DELETE FROM discoveries WHERE id IN (
          SELECT id FROM discoveries ORDER BY discovered_at ASC LIMIT ?
        )
      `).run(excess);
            console.error(`[Pensieve] Pruned ${excess} old discoveries`);
        }
        // Prune resolved questions older than 30 days
        this.db.prepare(`
      DELETE FROM open_questions
      WHERE status = 'resolved'
      AND datetime(resolved_at) < datetime('now', '-30 days')
    `).run();
    }
    initSchema() {
        this.db.exec(`
      -- Core discoveries about the codebase
      CREATE TABLE IF NOT EXISTS discoveries (
        id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        location TEXT,
        description TEXT,
        metadata TEXT,
        discovered_at TEXT DEFAULT (datetime('now')),
        confidence REAL DEFAULT 1.0
      );

      -- Architectural and design decisions
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY,
        topic TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT,
        alternatives TEXT,
        decided_at TEXT DEFAULT (datetime('now')),
        source TEXT
      );

      -- User preferences and conventions
      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        notes TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(category, key)
      );

      -- Session summaries for continuity
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        summary TEXT,
        work_in_progress TEXT,
        next_steps TEXT,
        key_files TEXT,
        tags TEXT
      );

      -- Entities/domain model understanding
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        relationships TEXT,
        attributes TEXT,
        location TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Open questions and blockers
      CREATE TABLE IF NOT EXISTS open_questions (
        id INTEGER PRIMARY KEY,
        question TEXT NOT NULL,
        context TEXT,
        status TEXT DEFAULT 'open',
        resolution TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_discoveries_category ON discoveries(category);
      CREATE INDEX IF NOT EXISTS idx_discoveries_name ON discoveries(name);
      CREATE INDEX IF NOT EXISTS idx_decisions_topic ON decisions(topic);
      CREATE INDEX IF NOT EXISTS idx_preferences_category ON preferences(category);
      CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
      CREATE INDEX IF NOT EXISTS idx_open_questions_status ON open_questions(status);
    `);
    }
    // Decision methods
    addDecision(decision) {
        this.ensureWritable();
        this.pruneIfNeeded();
        const stmt = this.db.prepare(`
      INSERT INTO decisions (topic, decision, rationale, alternatives, source)
      VALUES (?, ?, ?, ?, ?)
    `);
        const result = stmt.run(this.truncateField(decision.topic, 'topic'), this.truncateField(decision.decision, 'decision'), this.truncateField(decision.rationale, 'rationale'), this.truncateField(decision.alternatives, 'alternatives'), decision.source || 'user');
        return result.lastInsertRowid;
    }
    searchDecisions(query) {
        const stmt = this.db.prepare(`
      SELECT * FROM decisions
      WHERE topic LIKE ? OR decision LIKE ? OR rationale LIKE ?
      ORDER BY decided_at DESC
      LIMIT 50
    `);
        const pattern = `%${query}%`;
        return stmt.all(pattern, pattern, pattern);
    }
    getRecentDecisions(limit = 10) {
        const stmt = this.db.prepare(`
      SELECT * FROM decisions
      ORDER BY decided_at DESC
      LIMIT ?
    `);
        return stmt.all(limit);
    }
    // Preference methods
    setPreference(pref) {
        this.ensureWritable();
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO preferences (category, key, value, notes, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
        stmt.run(this.truncateField(pref.category, 'category'), this.truncateField(pref.key, 'key'), this.truncateField(pref.value, 'value'), this.truncateField(pref.notes, 'notes'));
    }
    getPreference(category, key) {
        const stmt = this.db.prepare(`
      SELECT * FROM preferences WHERE category = ? AND key = ?
    `);
        return stmt.get(category, key);
    }
    getPreferencesByCategory(category) {
        const stmt = this.db.prepare(`
      SELECT * FROM preferences WHERE category = ? ORDER BY key
    `);
        return stmt.all(category);
    }
    getAllPreferences() {
        const stmt = this.db.prepare(`
      SELECT * FROM preferences ORDER BY category, key
    `);
        return stmt.all();
    }
    // Discovery methods
    addDiscovery(discovery) {
        this.ensureWritable();
        this.pruneIfNeeded();
        const stmt = this.db.prepare(`
      INSERT INTO discoveries (category, name, location, description, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(this.truncateField(discovery.category, 'category'), this.truncateField(discovery.name, 'name'), this.truncateField(discovery.location, 'location'), this.truncateField(discovery.description, 'description'), this.truncateField(discovery.metadata, 'metadata'), discovery.confidence || 1.0);
        return result.lastInsertRowid;
    }
    searchDiscoveries(query) {
        const stmt = this.db.prepare(`
      SELECT * FROM discoveries
      WHERE name LIKE ? OR description LIKE ? OR location LIKE ?
      ORDER BY discovered_at DESC
      LIMIT 50
    `);
        const pattern = `%${query}%`;
        return stmt.all(pattern, pattern, pattern);
    }
    getDiscoveriesByCategory(category) {
        const stmt = this.db.prepare(`
      SELECT * FROM discoveries WHERE category = ? ORDER BY name
    `);
        return stmt.all(category);
    }
    // Entity methods
    upsertEntity(entity) {
        this.ensureWritable();
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities (name, description, relationships, attributes, location, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
        stmt.run(this.truncateField(entity.name, 'name'), this.truncateField(entity.description, 'description'), this.truncateField(entity.relationships, 'relationships'), this.truncateField(entity.attributes, 'attributes'), this.truncateField(entity.location, 'location'));
    }
    getEntity(name) {
        const stmt = this.db.prepare(`SELECT * FROM entities WHERE name = ?`);
        return stmt.get(name);
    }
    getAllEntities() {
        const stmt = this.db.prepare(`SELECT * FROM entities ORDER BY name`);
        return stmt.all();
    }
    // Session methods
    startSession() {
        this.ensureWritable();
        const stmt = this.db.prepare(`INSERT INTO sessions (started_at) VALUES (datetime('now'))`);
        const result = stmt.run();
        return result.lastInsertRowid;
    }
    endSession(sessionId, summary, workInProgress, nextSteps, keyFiles, tags) {
        this.ensureWritable();
        this.pruneIfNeeded();
        const stmt = this.db.prepare(`
      UPDATE sessions
      SET ended_at = datetime('now'),
          summary = ?,
          work_in_progress = ?,
          next_steps = ?,
          key_files = ?,
          tags = ?
      WHERE id = ?
    `);
        stmt.run(this.truncateField(summary, 'summary'), this.truncateField(workInProgress, 'work_in_progress'), this.truncateField(nextSteps, 'next_steps'), keyFiles ? this.truncateField(JSON.stringify(keyFiles), 'key_files') : null, tags ? tags.join(',') : null, sessionId);
    }
    getLastSession() {
        const stmt = this.db.prepare(`
      SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1
    `);
        return stmt.get();
    }
    getCurrentSession() {
        const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
    `);
        return stmt.get();
    }
    // Open questions methods
    addQuestion(question, context) {
        this.ensureWritable();
        const stmt = this.db.prepare(`
      INSERT INTO open_questions (question, context) VALUES (?, ?)
    `);
        const result = stmt.run(this.truncateField(question, 'question'), this.truncateField(context, 'context'));
        return result.lastInsertRowid;
    }
    resolveQuestion(id, resolution) {
        this.ensureWritable();
        const stmt = this.db.prepare(`
      UPDATE open_questions
      SET status = 'resolved', resolution = ?, resolved_at = datetime('now')
      WHERE id = ?
    `);
        stmt.run(resolution, id);
    }
    getOpenQuestions() {
        const stmt = this.db.prepare(`
      SELECT * FROM open_questions WHERE status = 'open' ORDER BY created_at DESC
    `);
        return stmt.all();
    }
    // General search
    search(query) {
        return {
            decisions: this.searchDecisions(query),
            discoveries: this.searchDiscoveries(query),
            entities: this.getAllEntities().filter(e => e.name.toLowerCase().includes(query.toLowerCase()) ||
                e.description?.toLowerCase().includes(query.toLowerCase()))
        };
    }
    // Get database path for debugging
    getPath() {
        return this.dbPath;
    }
    close() {
        this.db.close();
    }
}
