import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
export class MemoryDatabase {
    db;
    projectPath;
    constructor(projectPath) {
        // Use provided path, or detect from current directory, or use home
        this.projectPath = projectPath || process.cwd();
        const dbPath = this.getDbPath();
        // Ensure directory exists
        const dbDir = dirname(dbPath);
        if (!existsSync(dbDir)) {
            mkdirSync(dbDir, { recursive: true });
        }
        this.db = new Database(dbPath);
        this.initSchema();
    }
    getDbPath() {
        // Try project-local first, then fall back to home directory
        const localPath = join(this.projectPath, '.pensieve', 'memory.sqlite');
        const globalPath = join(homedir(), '.claude-pensieve', 'memory.sqlite');
        // If local .pensieve directory exists or we're in a git repo, use local
        if (existsSync(join(this.projectPath, '.pensieve')) ||
            existsSync(join(this.projectPath, '.git'))) {
            return localPath;
        }
        return globalPath;
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
        const stmt = this.db.prepare(`
      INSERT INTO decisions (topic, decision, rationale, alternatives, source)
      VALUES (?, ?, ?, ?, ?)
    `);
        const result = stmt.run(decision.topic, decision.decision, decision.rationale || null, decision.alternatives || null, decision.source || 'user');
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
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO preferences (category, key, value, notes, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
        stmt.run(pref.category, pref.key, pref.value, pref.notes || null);
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
        const stmt = this.db.prepare(`
      INSERT INTO discoveries (category, name, location, description, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(discovery.category, discovery.name, discovery.location || null, discovery.description || null, discovery.metadata || null, discovery.confidence || 1.0);
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
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities (name, description, relationships, attributes, location, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
        stmt.run(entity.name, entity.description || null, entity.relationships || null, entity.attributes || null, entity.location || null);
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
        const stmt = this.db.prepare(`INSERT INTO sessions (started_at) VALUES (datetime('now'))`);
        const result = stmt.run();
        return result.lastInsertRowid;
    }
    endSession(sessionId, summary, workInProgress, nextSteps, keyFiles, tags) {
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
        stmt.run(summary, workInProgress || null, nextSteps || null, keyFiles ? JSON.stringify(keyFiles) : null, tags ? tags.join(',') : null, sessionId);
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
        const stmt = this.db.prepare(`
      INSERT INTO open_questions (question, context) VALUES (?, ?)
    `);
        const result = stmt.run(question, context || null);
        return result.lastInsertRowid;
    }
    resolveQuestion(id, resolution) {
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
        return this.getDbPath();
    }
    close() {
        this.db.close();
    }
}
