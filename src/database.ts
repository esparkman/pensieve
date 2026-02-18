import initSqlJs, { Database as SqlJsDatabase, SqlValue } from 'sql.js';
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
  archived_at?: string | null;
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
  archived_at?: string | null;
}

export interface Entity {
  id?: number;
  name: string;
  description?: string;
  relationships?: string;
  attributes?: string;
  location?: string;
  updated_at?: string;
  archived_at?: string | null;
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
  archived_at?: string | null;
}

export interface ArchiveStats {
  table: string;
  affected: number;
}

export interface MemoryStats {
  decisions: { active: number; archived: number };
  discoveries: { active: number; archived: number };
  entities: { active: number; archived: number };
  open_questions: { active: number; archived: number };
}

export class MemoryDatabase {
  private db: SqlJsDatabase;
  private dbPath: string;

  private static readonly ARCHIVABLE_TABLES = ['decisions', 'discoveries', 'entities', 'open_questions'];
  private static readonly TABLE_DATE_COLUMNS: Record<string, string> = {
    decisions: 'decided_at',
    discoveries: 'discovered_at',
    entities: 'updated_at',
    open_questions: 'created_at',
  };

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /**
   * Create a new MemoryDatabase instance (async factory)
   */
  static async create(projectPath?: string): Promise<MemoryDatabase> {
    const dbPath = MemoryDatabase.getDbPath(projectPath || process.cwd());

    // Ensure directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Initialize sql.js
    const SQL = await initSqlJs();

    // Load existing database or create new one
    let db: SqlJsDatabase;
    if (existsSync(dbPath)) {
      try {
        const fileBuffer = readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        console.error(`[Pensieve] Loaded existing database: ${dbPath}`);
      } catch (error) {
        console.error(`[Pensieve] Failed to load database, creating new: ${error}`);
        db = new SQL.Database();
      }
    } else {
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
  private save(): void {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error(`[Pensieve] Failed to save database: ${error}`);
    }
  }

  private static getDbPath(projectPath: string): string {
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
    this.db.run(`
      DELETE FROM sessions
      WHERE ended_at IS NOT NULL
      AND datetime(ended_at) < datetime('now', '-${LIMITS.SESSION_RETENTION_DAYS} days')
    `);

    // Prune excess decisions (keep most recent)
    const decisionResult = this.db.exec('SELECT COUNT(*) as count FROM decisions WHERE archived_at IS NULL');
    const decisionCount = decisionResult.length > 0 ? decisionResult[0].values[0][0] as number : 0;
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
    const discoveryResult = this.db.exec('SELECT COUNT(*) as count FROM discoveries WHERE archived_at IS NULL');
    const discoveryCount = discoveryResult.length > 0 ? discoveryResult[0].values[0][0] as number : 0;
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

  private initSchema(): void {
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

    this.migrateSchema();
  }

  private migrateSchema(): void {
    for (const table of MemoryDatabase.ARCHIVABLE_TABLES) {
      const result = this.db.exec(`PRAGMA table_info(${table})`);
      const columns = result.length > 0 ? result[0].values.map(row => row[1] as string) : [];

      if (!columns.includes('archived_at')) {
        this.db.run(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT DEFAULT NULL`);
        console.error(`[Pensieve] Migration: Added archived_at column to ${table}`);
      }

      this.db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_archived ON ${table}(archived_at)`);
    }
  }

  /**
   * Get last inserted row ID
   */
  private getLastInsertRowId(): number {
    const result = this.db.exec('SELECT last_insert_rowid()');
    return result.length > 0 ? result[0].values[0][0] as number : 0;
  }

  /**
   * Execute a query and return all rows as objects
   */
  private queryAll<T>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  /**
   * Execute a query and return the first row as an object
   */
  private queryOne<T>(sql: string, params: SqlValue[] = []): T | undefined {
    const results = this.queryAll<T>(sql, params);
    return results.length > 0 ? results[0] : undefined;
  }

  // Decision methods
  addDecision(decision: Decision): number {
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

  searchDecisions(query: string): Decision[] {
    const pattern = `%${query}%`;
    return this.queryAll<Decision>(`
      SELECT * FROM decisions
      WHERE (topic LIKE ? OR decision LIKE ? OR rationale LIKE ?)
        AND archived_at IS NULL
      ORDER BY decided_at DESC
      LIMIT 50
    `, [pattern, pattern, pattern]);
  }

  getRecentDecisions(limit: number = 10): Decision[] {
    return this.queryAll<Decision>(`
      SELECT * FROM decisions
      WHERE archived_at IS NULL
      ORDER BY decided_at DESC
      LIMIT ?
    `, [limit]);
  }

  // Preference methods
  setPreference(pref: Preference): void {
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

  getPreference(category: string, key: string): Preference | undefined {
    return this.queryOne<Preference>(`
      SELECT * FROM preferences WHERE category = ? AND key = ?
    `, [category, key]);
  }

  getPreferencesByCategory(category: string): Preference[] {
    return this.queryAll<Preference>(`
      SELECT * FROM preferences WHERE category = ? ORDER BY key
    `, [category]);
  }

  getAllPreferences(): Preference[] {
    return this.queryAll<Preference>(`
      SELECT * FROM preferences ORDER BY category, key
    `);
  }

  // Discovery methods
  addDiscovery(discovery: Discovery): number {
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

  searchDiscoveries(query: string): Discovery[] {
    const pattern = `%${query}%`;
    return this.queryAll<Discovery>(`
      SELECT * FROM discoveries
      WHERE (name LIKE ? OR description LIKE ? OR location LIKE ?)
        AND archived_at IS NULL
      ORDER BY discovered_at DESC
      LIMIT 50
    `, [pattern, pattern, pattern]);
  }

  getDiscoveriesByCategory(category: string): Discovery[] {
    return this.queryAll<Discovery>(`
      SELECT * FROM discoveries WHERE category = ? AND archived_at IS NULL ORDER BY name
    `, [category]);
  }

  getAllDiscoveries(): Discovery[] {
    return this.queryAll<Discovery>(`
      SELECT * FROM discoveries WHERE archived_at IS NULL ORDER BY discovered_at DESC
    `);
  }

  getRecentDiscoveries(limit: number = 10): Discovery[] {
    return this.queryAll<Discovery>(`
      SELECT * FROM discoveries WHERE archived_at IS NULL ORDER BY discovered_at DESC LIMIT ?
    `, [limit]);
  }

  // Entity methods
  upsertEntity(entity: Entity): void {
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

  getEntity(name: string): Entity | undefined {
    return this.queryOne<Entity>(`SELECT * FROM entities WHERE name = ? AND archived_at IS NULL`, [name]);
  }

  getAllEntities(): Entity[] {
    return this.queryAll<Entity>(`SELECT * FROM entities WHERE archived_at IS NULL ORDER BY name`);
  }

  // Session methods
  startSession(): number {
    this.db.run(`INSERT INTO sessions (started_at) VALUES (datetime('now'))`);
    const id = this.getLastInsertRowId();
    this.save();
    return id;
  }

  endSession(sessionId: number, summary: string, workInProgress?: string, nextSteps?: string, keyFiles?: string[], tags?: string[]): void {
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

  getLastSession(): Session | undefined {
    return this.queryOne<Session>(`
      SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1
    `);
  }

  getCurrentSession(): Session | undefined {
    return this.queryOne<Session>(`
      SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
    `);
  }

  // Open questions methods
  addQuestion(question: string, context?: string): number {
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

  resolveQuestion(id: number, resolution: string): void {
    this.db.run(`
      UPDATE open_questions
      SET status = 'resolved', resolution = ?, resolved_at = datetime('now')
      WHERE id = ?
    `, [resolution, id]);
    this.save();
  }

  getOpenQuestions(): OpenQuestion[] {
    return this.queryAll<OpenQuestion>(`
      SELECT * FROM open_questions WHERE status = 'open' AND archived_at IS NULL ORDER BY created_at DESC
    `);
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

  // Archive & prune methods

  private validateTables(tables?: string[]): string[] {
    const target = tables || MemoryDatabase.ARCHIVABLE_TABLES;
    for (const t of target) {
      if (!MemoryDatabase.ARCHIVABLE_TABLES.includes(t)) {
        throw new Error(`Invalid table: ${t}. Must be one of: ${MemoryDatabase.ARCHIVABLE_TABLES.join(', ')}`);
      }
    }
    return target;
  }

  archiveOlderThan(days: number, tables?: string[]): ArchiveStats[] {
    const target = this.validateTables(tables);
    const results: ArchiveStats[] = [];

    for (const table of target) {
      const dateCol = MemoryDatabase.TABLE_DATE_COLUMNS[table];
      this.db.run(`
        UPDATE ${table}
        SET archived_at = datetime('now')
        WHERE archived_at IS NULL
          AND datetime(${dateCol}) < datetime('now', '-${days} days')
      `);
      const changes = this.db.getRowsModified();
      results.push({ table, affected: changes });
    }

    this.save();
    return results;
  }

  archiveByIds(table: string, ids: number[]): number {
    this.validateTables([table]);
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => '?').join(',');
    this.db.run(`
      UPDATE ${table}
      SET archived_at = datetime('now')
      WHERE id IN (${placeholders}) AND archived_at IS NULL
    `, ids as SqlValue[]);

    const changes = this.db.getRowsModified();
    this.save();
    return changes;
  }

  restoreByIds(table: string, ids: number[]): number {
    this.validateTables([table]);
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => '?').join(',');
    this.db.run(`
      UPDATE ${table}
      SET archived_at = NULL
      WHERE id IN (${placeholders}) AND archived_at IS NOT NULL
    `, ids as SqlValue[]);

    const changes = this.db.getRowsModified();
    this.save();
    return changes;
  }

  restoreAll(tables?: string[]): ArchiveStats[] {
    const target = this.validateTables(tables);
    const results: ArchiveStats[] = [];

    for (const table of target) {
      this.db.run(`UPDATE ${table} SET archived_at = NULL WHERE archived_at IS NOT NULL`);
      const changes = this.db.getRowsModified();
      results.push({ table, affected: changes });
    }

    this.save();
    return results;
  }

  pruneOlderThan(days: number, tables?: string[], archivedOnly: boolean = false): ArchiveStats[] {
    const target = this.validateTables(tables);
    const results: ArchiveStats[] = [];

    for (const table of target) {
      const dateCol = MemoryDatabase.TABLE_DATE_COLUMNS[table];
      const archivedFilter = archivedOnly ? ' AND archived_at IS NOT NULL' : '';
      this.db.run(`
        DELETE FROM ${table}
        WHERE datetime(${dateCol}) < datetime('now', '-${days} days')${archivedFilter}
      `);
      const changes = this.db.getRowsModified();
      results.push({ table, affected: changes });
    }

    this.save();
    return results;
  }

  purgeArchived(tables?: string[]): ArchiveStats[] {
    const target = this.validateTables(tables);
    const results: ArchiveStats[] = [];

    for (const table of target) {
      this.db.run(`DELETE FROM ${table} WHERE archived_at IS NOT NULL`);
      const changes = this.db.getRowsModified();
      results.push({ table, affected: changes });
    }

    this.save();
    return results;
  }

  getMemoryStats(): MemoryStats {
    const stats: Record<string, { active: number; archived: number }> = {};

    for (const table of MemoryDatabase.ARCHIVABLE_TABLES) {
      const result = this.db.exec(`
        SELECT
          SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) as archived
        FROM ${table}
      `);

      if (result.length > 0 && result[0].values.length > 0) {
        stats[table] = {
          active: (result[0].values[0][0] as number) || 0,
          archived: (result[0].values[0][1] as number) || 0,
        };
      } else {
        stats[table] = { active: 0, archived: 0 };
      }
    }

    return stats as unknown as MemoryStats;
  }

  getArchivedEntries<T>(table: string): T[] {
    this.validateTables([table]);
    return this.queryAll<T>(`
      SELECT * FROM ${table} WHERE archived_at IS NOT NULL ORDER BY archived_at DESC
    `);
  }

  // Get database path for debugging
  getPath(): string {
    return this.dbPath;
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
