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
} as const;

// Types
export interface Decision {
  id?: number;
  topic: string;
  decision: string;
  rationale?: string;
  alternatives?: string;
  decided_at?: string;
  source?: string;
}

export interface Preference {
  id?: number;
  category: string;
  key: string;
  value: string;
  notes?: string;
  updated_at?: string;
}

export interface Discovery {
  id?: number;
  category: string;
  name: string;
  location?: string;
  description?: string;
  metadata?: string;
  discovered_at?: string;
  confidence?: number;
}

export interface Entity {
  id?: number;
  name: string;
  description?: string;
  relationships?: string;
  attributes?: string;
  location?: string;
  updated_at?: string;
}

export interface Session {
  id?: number;
  started_at?: string;
  ended_at?: string;
  summary?: string;
  work_in_progress?: string;
  next_steps?: string;
  key_files?: string;
  tags?: string;
}

export interface OpenQuestion {
  id?: number;
  question: string;
  context?: string;
  status?: string;
  resolution?: string;
  created_at?: string;
  resolved_at?: string;
}

export class MemoryDatabase {
  private db: Database.Database;
  private projectPath: string;

  constructor(projectPath?: string) {
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

  private getDbPath(): string {
    // Check for explicit environment variable override first
    const envPath = process.env.PENSIEVE_DB_PATH;
    if (envPath) {
      console.error(`[Pensieve] Using database from PENSIEVE_DB_PATH: ${envPath}`);
      return envPath;
    }

    // Try project-local first, then fall back to home directory
    const localPath = join(this.projectPath, '.pensieve', 'memory.sqlite');
    const globalPath = join(homedir(), '.claude-pensieve', 'memory.sqlite');

    // If local .pensieve directory exists or we're in a git repo, use local
    if (existsSync(join(this.projectPath, '.pensieve')) ||
        existsSync(join(this.projectPath, '.git'))) {
      console.error(`[Pensieve] Using project-local database: ${localPath}`);
      return localPath;
    }

    console.error(`[Pensieve] Using global database: ${globalPath}`);
    return globalPath;
  }

  /**
   * Truncate a string to the maximum field length
   */
  private truncateField(value: string | undefined | null, fieldName?: string): string | null {
    if (!value) return null;
    if (value.length <= LIMITS.MAX_FIELD_LENGTH) return value;

    console.error(`[Pensieve] Warning: Truncating ${fieldName || 'field'} from ${value.length} to ${LIMITS.MAX_FIELD_LENGTH} chars`);
    return value.substring(0, LIMITS.MAX_FIELD_LENGTH) + '... [truncated]';
  }

  /**
   * Prune old entries when limits are exceeded
   */
  private pruneIfNeeded(): void {
    // Prune old sessions beyond retention period
    this.db.prepare(`
      DELETE FROM sessions
      WHERE ended_at IS NOT NULL
      AND datetime(ended_at) < datetime('now', '-${LIMITS.SESSION_RETENTION_DAYS} days')
    `).run();

    // Prune excess decisions (keep most recent)
    const decisionCount = (this.db.prepare('SELECT COUNT(*) as count FROM decisions').get() as { count: number }).count;
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
    const discoveryCount = (this.db.prepare('SELECT COUNT(*) as count FROM discoveries').get() as { count: number }).count;
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

  private initSchema(): void {
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
  addDecision(decision: Decision): number {
    this.pruneIfNeeded();

    const stmt = this.db.prepare(`
      INSERT INTO decisions (topic, decision, rationale, alternatives, source)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      this.truncateField(decision.topic, 'topic'),
      this.truncateField(decision.decision, 'decision'),
      this.truncateField(decision.rationale, 'rationale'),
      this.truncateField(decision.alternatives, 'alternatives'),
      decision.source || 'user'
    );
    return result.lastInsertRowid as number;
  }

  searchDecisions(query: string): Decision[] {
    const stmt = this.db.prepare(`
      SELECT * FROM decisions
      WHERE topic LIKE ? OR decision LIKE ? OR rationale LIKE ?
      ORDER BY decided_at DESC
      LIMIT 50
    `);
    const pattern = `%${query}%`;
    return stmt.all(pattern, pattern, pattern) as Decision[];
  }

  getRecentDecisions(limit: number = 10): Decision[] {
    const stmt = this.db.prepare(`
      SELECT * FROM decisions
      ORDER BY decided_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Decision[];
  }

  // Preference methods
  setPreference(pref: Preference): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO preferences (category, key, value, notes, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      this.truncateField(pref.category, 'category'),
      this.truncateField(pref.key, 'key'),
      this.truncateField(pref.value, 'value'),
      this.truncateField(pref.notes, 'notes')
    );
  }

  getPreference(category: string, key: string): Preference | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM preferences WHERE category = ? AND key = ?
    `);
    return stmt.get(category, key) as Preference | undefined;
  }

  getPreferencesByCategory(category: string): Preference[] {
    const stmt = this.db.prepare(`
      SELECT * FROM preferences WHERE category = ? ORDER BY key
    `);
    return stmt.all(category) as Preference[];
  }

  getAllPreferences(): Preference[] {
    const stmt = this.db.prepare(`
      SELECT * FROM preferences ORDER BY category, key
    `);
    return stmt.all() as Preference[];
  }

  // Discovery methods
  addDiscovery(discovery: Discovery): number {
    this.pruneIfNeeded();

    const stmt = this.db.prepare(`
      INSERT INTO discoveries (category, name, location, description, metadata, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      this.truncateField(discovery.category, 'category'),
      this.truncateField(discovery.name, 'name'),
      this.truncateField(discovery.location, 'location'),
      this.truncateField(discovery.description, 'description'),
      this.truncateField(discovery.metadata, 'metadata'),
      discovery.confidence || 1.0
    );
    return result.lastInsertRowid as number;
  }

  searchDiscoveries(query: string): Discovery[] {
    const stmt = this.db.prepare(`
      SELECT * FROM discoveries
      WHERE name LIKE ? OR description LIKE ? OR location LIKE ?
      ORDER BY discovered_at DESC
      LIMIT 50
    `);
    const pattern = `%${query}%`;
    return stmt.all(pattern, pattern, pattern) as Discovery[];
  }

  getDiscoveriesByCategory(category: string): Discovery[] {
    const stmt = this.db.prepare(`
      SELECT * FROM discoveries WHERE category = ? ORDER BY name
    `);
    return stmt.all(category) as Discovery[];
  }

  // Entity methods
  upsertEntity(entity: Entity): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities (name, description, relationships, attributes, location, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      this.truncateField(entity.name, 'name'),
      this.truncateField(entity.description, 'description'),
      this.truncateField(entity.relationships, 'relationships'),
      this.truncateField(entity.attributes, 'attributes'),
      this.truncateField(entity.location, 'location')
    );
  }

  getEntity(name: string): Entity | undefined {
    const stmt = this.db.prepare(`SELECT * FROM entities WHERE name = ?`);
    return stmt.get(name) as Entity | undefined;
  }

  getAllEntities(): Entity[] {
    const stmt = this.db.prepare(`SELECT * FROM entities ORDER BY name`);
    return stmt.all() as Entity[];
  }

  // Session methods
  startSession(): number {
    const stmt = this.db.prepare(`INSERT INTO sessions (started_at) VALUES (datetime('now'))`);
    const result = stmt.run();
    return result.lastInsertRowid as number;
  }

  endSession(sessionId: number, summary: string, workInProgress?: string, nextSteps?: string, keyFiles?: string[], tags?: string[]): void {
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
    stmt.run(
      this.truncateField(summary, 'summary'),
      this.truncateField(workInProgress, 'work_in_progress'),
      this.truncateField(nextSteps, 'next_steps'),
      keyFiles ? this.truncateField(JSON.stringify(keyFiles), 'key_files') : null,
      tags ? tags.join(',') : null,
      sessionId
    );
  }

  getLastSession(): Session | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1
    `);
    return stmt.get() as Session | undefined;
  }

  getCurrentSession(): Session | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
    `);
    return stmt.get() as Session | undefined;
  }

  // Open questions methods
  addQuestion(question: string, context?: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO open_questions (question, context) VALUES (?, ?)
    `);
    const result = stmt.run(
      this.truncateField(question, 'question'),
      this.truncateField(context, 'context')
    );
    return result.lastInsertRowid as number;
  }

  resolveQuestion(id: number, resolution: string): void {
    const stmt = this.db.prepare(`
      UPDATE open_questions
      SET status = 'resolved', resolution = ?, resolved_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(resolution, id);
  }

  getOpenQuestions(): OpenQuestion[] {
    const stmt = this.db.prepare(`
      SELECT * FROM open_questions WHERE status = 'open' ORDER BY created_at DESC
    `);
    return stmt.all() as OpenQuestion[];
  }

  // General search
  search(query: string): { decisions: Decision[]; discoveries: Discovery[]; entities: Entity[] } {
    return {
      decisions: this.searchDecisions(query),
      discoveries: this.searchDiscoveries(query),
      entities: this.getAllEntities().filter(e =>
        e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.description?.toLowerCase().includes(query.toLowerCase())
      )
    };
  }

  // Get database path for debugging
  getPath(): string {
    return this.getDbPath();
  }

  close(): void {
    this.db.close();
  }
}
