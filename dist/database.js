import initSqlJs from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
    dbPath;
    constructor(db, dbPath) {
        this.db = db;
        this.dbPath = dbPath;
    }
    /**
     * Create a new MemoryDatabase instance (async factory)
     */
    static async create(projectPath) {
        const dbPath = MemoryDatabase.getDbPath(projectPath || process.cwd());
        // Ensure directory exists
        const dbDir = dirname(dbPath);
        if (!existsSync(dbDir)) {
            mkdirSync(dbDir, { recursive: true });
        }
        // Initialize sql.js
        const SQL = await initSqlJs();
        // Load existing database or create new one
        let db;
        if (existsSync(dbPath)) {
            try {
                const fileBuffer = readFileSync(dbPath);
                db = new SQL.Database(fileBuffer);
                console.error(`[Pensieve] Loaded existing database: ${dbPath}`);
            }
            catch (error) {
                console.error(`[Pensieve] Failed to load database, creating new: ${error}`);
                db = new SQL.Database();
            }
        }
        else {
            db = new SQL.Database();
            console.error(`[Pensieve] Created new database: ${dbPath}`);
        }
        const instance = new MemoryDatabase(db, dbPath);
        instance.initSchema();
        instance.save(); // Ensure schema is persisted
        return instance;
    }
    /**
     * Save database to disk
     */
    save() {
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            writeFileSync(this.dbPath, buffer);
        }
        catch (error) {
            console.error(`[Pensieve] Failed to save database: ${error}`);
        }
    }
    static getDbPath(projectPath) {
        // Check for explicit database path override
        const envPath = process.env.PENSIEVE_DB_PATH;
        if (envPath) {
            console.error(`[Pensieve] Using database from PENSIEVE_DB_PATH: ${envPath}`);
            return envPath;
        }
        // Check for explicit project path (recommended for MCP server usage)
        const projectDir = process.env.PENSIEVE_PROJECT_DIR;
        if (projectDir) {
            const projectDbPath = join(projectDir, '.pensieve', 'memory.sqlite');
            console.error(`[Pensieve] Using project database from PENSIEVE_PROJECT_DIR: ${projectDbPath}`);
            return projectDbPath;
        }
        // Fallback: Try project-local first, then fall back to home directory
        const localPath = join(projectPath, '.pensieve', 'memory.sqlite');
        const globalPath = join(homedir(), '.claude-pensieve', 'memory.sqlite');
        // If local .pensieve directory exists or we're in a git repo, use local
        if (existsSync(join(projectPath, '.pensieve')) ||
            existsSync(join(projectPath, '.git'))) {
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
        this.db.run(`
      DELETE FROM sessions
      WHERE ended_at IS NOT NULL
      AND datetime(ended_at) < datetime('now', '-${LIMITS.SESSION_RETENTION_DAYS} days')
    `);
        // Prune excess decisions (keep most recent)
        const decisionResult = this.db.exec('SELECT COUNT(*) as count FROM decisions');
        const decisionCount = decisionResult.length > 0 ? decisionResult[0].values[0][0] : 0;
        if (decisionCount > LIMITS.MAX_DECISIONS) {
            const excess = decisionCount - LIMITS.MAX_DECISIONS;
            this.db.run(`
        DELETE FROM decisions WHERE id IN (
          SELECT id FROM decisions ORDER BY decided_at ASC LIMIT ?
        )
      `, [excess]);
            console.error(`[Pensieve] Pruned ${excess} old decisions`);
        }
        // Prune excess discoveries
        const discoveryResult = this.db.exec('SELECT COUNT(*) as count FROM discoveries');
        const discoveryCount = discoveryResult.length > 0 ? discoveryResult[0].values[0][0] : 0;
        if (discoveryCount > LIMITS.MAX_DISCOVERIES) {
            const excess = discoveryCount - LIMITS.MAX_DISCOVERIES;
            this.db.run(`
        DELETE FROM discoveries WHERE id IN (
          SELECT id FROM discoveries ORDER BY discovered_at ASC LIMIT ?
        )
      `, [excess]);
            console.error(`[Pensieve] Pruned ${excess} old discoveries`);
        }
        // Prune resolved questions older than 30 days
        this.db.run(`
      DELETE FROM open_questions
      WHERE status = 'resolved'
      AND datetime(resolved_at) < datetime('now', '-30 days')
    `);
    }
    initSchema() {
        this.db.run(`
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
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY,
        topic TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT,
        alternatives TEXT,
        decided_at TEXT DEFAULT (datetime('now')),
        source TEXT
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        notes TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(category, key)
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        summary TEXT,
        work_in_progress TEXT,
        next_steps TEXT,
        key_files TEXT,
        tags TEXT
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        relationships TEXT,
        attributes TEXT,
        location TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS open_questions (
        id INTEGER PRIMARY KEY,
        question TEXT NOT NULL,
        context TEXT,
        status TEXT DEFAULT 'open',
        resolution TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT
      )
    `);
        // Create indexes
        this.db.run('CREATE INDEX IF NOT EXISTS idx_discoveries_category ON discoveries(category)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_discoveries_name ON discoveries(name)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_decisions_topic ON decisions(topic)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_preferences_category ON preferences(category)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_open_questions_status ON open_questions(status)');
    }
    /**
     * Get last inserted row ID
     */
    getLastInsertRowId() {
        const result = this.db.exec('SELECT last_insert_rowid()');
        return result.length > 0 ? result[0].values[0][0] : 0;
    }
    /**
     * Execute a query and return all rows as objects
     */
    queryAll(sql, params = []) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    }
    /**
     * Execute a query and return the first row as an object
     */
    queryOne(sql, params = []) {
        const results = this.queryAll(sql, params);
        return results.length > 0 ? results[0] : undefined;
    }
    // Decision methods
    addDecision(decision) {
        this.pruneIfNeeded();
        this.db.run(`
      INSERT INTO decisions (topic, decision, rationale, alternatives, source)
      VALUES (?, ?, ?, ?, ?)
    `, [
            this.truncateField(decision.topic, 'topic'),
            this.truncateField(decision.decision, 'decision'),
            this.truncateField(decision.rationale, 'rationale'),
            this.truncateField(decision.alternatives, 'alternatives'),
            decision.source || 'user'
        ]);
        const id = this.getLastInsertRowId();
        this.save();
        return id;
    }
    searchDecisions(query) {
        const pattern = `%${query}%`;
        return this.queryAll(`
      SELECT * FROM decisions
      WHERE topic LIKE ? OR decision LIKE ? OR rationale LIKE ?
      ORDER BY decided_at DESC
      LIMIT 50
    `, [pattern, pattern, pattern]);
    }
    getRecentDecisions(limit = 10) {
        return this.queryAll(`
      SELECT * FROM decisions
      ORDER BY decided_at DESC
      LIMIT ?
    `, [limit]);
    }
    // Preference methods
    setPreference(pref) {
        this.db.run(`
      INSERT OR REPLACE INTO preferences (category, key, value, notes, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `, [
            this.truncateField(pref.category, 'category'),
            this.truncateField(pref.key, 'key'),
            this.truncateField(pref.value, 'value'),
            this.truncateField(pref.notes, 'notes')
        ]);
        this.save();
    }
    getPreference(category, key) {
        return this.queryOne(`
      SELECT * FROM preferences WHERE category = ? AND key = ?
    `, [category, key]);
    }
    getPreferencesByCategory(category) {
        return this.queryAll(`
      SELECT * FROM preferences WHERE category = ? ORDER BY key
    `, [category]);
    }
    getAllPreferences() {
        return this.queryAll(`
      SELECT * FROM preferences ORDER BY category, key
    `);
    }
    // Discovery methods
    addDiscovery(discovery) {
        this.pruneIfNeeded();
        this.db.run(`
      INSERT INTO discoveries (category, name, location, description, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
            this.truncateField(discovery.category, 'category'),
            this.truncateField(discovery.name, 'name'),
            this.truncateField(discovery.location, 'location'),
            this.truncateField(discovery.description, 'description'),
            this.truncateField(discovery.metadata, 'metadata'),
            discovery.confidence || 1.0
        ]);
        const id = this.getLastInsertRowId();
        this.save();
        return id;
    }
    searchDiscoveries(query) {
        const pattern = `%${query}%`;
        return this.queryAll(`
      SELECT * FROM discoveries
      WHERE name LIKE ? OR description LIKE ? OR location LIKE ?
      ORDER BY discovered_at DESC
      LIMIT 50
    `, [pattern, pattern, pattern]);
    }
    getDiscoveriesByCategory(category) {
        return this.queryAll(`
      SELECT * FROM discoveries WHERE category = ? ORDER BY name
    `, [category]);
    }
    // Entity methods
    upsertEntity(entity) {
        this.db.run(`
      INSERT OR REPLACE INTO entities (name, description, relationships, attributes, location, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [
            this.truncateField(entity.name, 'name'),
            this.truncateField(entity.description, 'description'),
            this.truncateField(entity.relationships, 'relationships'),
            this.truncateField(entity.attributes, 'attributes'),
            this.truncateField(entity.location, 'location')
        ]);
        this.save();
    }
    getEntity(name) {
        return this.queryOne(`SELECT * FROM entities WHERE name = ?`, [name]);
    }
    getAllEntities() {
        return this.queryAll(`SELECT * FROM entities ORDER BY name`);
    }
    // Session methods
    startSession() {
        this.db.run(`INSERT INTO sessions (started_at) VALUES (datetime('now'))`);
        const id = this.getLastInsertRowId();
        this.save();
        return id;
    }
    endSession(sessionId, summary, workInProgress, nextSteps, keyFiles, tags) {
        this.pruneIfNeeded();
        this.db.run(`
      UPDATE sessions
      SET ended_at = datetime('now'),
          summary = ?,
          work_in_progress = ?,
          next_steps = ?,
          key_files = ?,
          tags = ?
      WHERE id = ?
    `, [
            this.truncateField(summary, 'summary'),
            this.truncateField(workInProgress, 'work_in_progress'),
            this.truncateField(nextSteps, 'next_steps'),
            keyFiles ? this.truncateField(JSON.stringify(keyFiles), 'key_files') : null,
            tags ? tags.join(',') : null,
            sessionId
        ]);
        this.save();
    }
    getLastSession() {
        return this.queryOne(`
      SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1
    `);
    }
    getCurrentSession() {
        return this.queryOne(`
      SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
    `);
    }
    // Open questions methods
    addQuestion(question, context) {
        this.db.run(`
      INSERT INTO open_questions (question, context) VALUES (?, ?)
    `, [
            this.truncateField(question, 'question'),
            this.truncateField(context, 'context')
        ]);
        const id = this.getLastInsertRowId();
        this.save();
        return id;
    }
    resolveQuestion(id, resolution) {
        this.db.run(`
      UPDATE open_questions
      SET status = 'resolved', resolution = ?, resolved_at = datetime('now')
      WHERE id = ?
    `, [resolution, id]);
        this.save();
    }
    getOpenQuestions() {
        return this.queryAll(`
      SELECT * FROM open_questions WHERE status = 'open' ORDER BY created_at DESC
    `);
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
        this.save();
        this.db.close();
    }
}
