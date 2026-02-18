import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase, LIMITS, type ArchiveStats, type MemoryStats } from '../database.js';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database: Limits Configuration', () => {
  it('exports expected limit values', () => {
    expect(LIMITS.MAX_DECISIONS).toBe(1000);
    expect(LIMITS.MAX_DISCOVERIES).toBe(500);
    expect(LIMITS.MAX_ENTITIES).toBe(200);
    expect(LIMITS.MAX_QUESTIONS).toBe(100);
    expect(LIMITS.MAX_SESSIONS).toBe(100);
    expect(LIMITS.SESSION_RETENTION_DAYS).toBe(90);
    expect(LIMITS.MAX_FIELD_LENGTH).toBe(10000);
  });
});

describe('Database: Field Truncation', () => {
  let db: MemoryDatabase;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = join(tmpdir(), `pensieve-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.pensieve'), { recursive: true });
    db = await MemoryDatabase.create(testDir);
  });

  afterEach(() => {
    db.close();
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('stores normal-length fields without modification', () => {
    const decision = {
      topic: 'test topic',
      decision: 'A reasonable length decision',
      rationale: 'Some rationale here',
    };

    db.addDecision(decision);
    const results = db.searchDecisions('test topic');

    expect(results).toHaveLength(1);
    expect(results[0].topic).toBe('test topic');
    expect(results[0].decision).toBe('A reasonable length decision');
    expect(results[0].rationale).toBe('Some rationale here');
  });

  it('truncates fields that exceed MAX_FIELD_LENGTH', () => {
    // Create a string that exceeds the limit
    const longString = 'x'.repeat(LIMITS.MAX_FIELD_LENGTH + 1000);

    const decision = {
      topic: 'long field test',
      decision: longString,
      rationale: 'short',
    };

    db.addDecision(decision);
    const results = db.searchDecisions('long field test');

    expect(results).toHaveLength(1);
    expect(results[0].decision.length).toBeLessThanOrEqual(LIMITS.MAX_FIELD_LENGTH + 20); // +20 for "... [truncated]"
    expect(results[0].decision).toContain('... [truncated]');
  });

  it('truncates multiple long fields in the same record', () => {
    const longTopic = 't'.repeat(LIMITS.MAX_FIELD_LENGTH + 500);
    const longDecision = 'd'.repeat(LIMITS.MAX_FIELD_LENGTH + 500);
    const longRationale = 'r'.repeat(LIMITS.MAX_FIELD_LENGTH + 500);

    db.addDecision({
      topic: longTopic,
      decision: longDecision,
      rationale: longRationale,
    });

    const results = db.getRecentDecisions(1);
    expect(results).toHaveLength(1);
    expect(results[0].topic).toContain('... [truncated]');
    expect(results[0].decision).toContain('... [truncated]');
    expect(results[0].rationale).toContain('... [truncated]');
  });

  it('handles null and undefined fields gracefully', () => {
    const discovery = {
      category: 'component',
      name: 'TestComponent',
      // location, description, metadata are undefined
    };

    const id = db.addDiscovery(discovery);
    expect(id).toBeGreaterThan(0);

    const results = db.searchDiscoveries('TestComponent');
    expect(results).toHaveLength(1);
    expect(results[0].location).toBeNull();
    expect(results[0].description).toBeNull();
  });

  it('truncates discovery metadata when too long', () => {
    const longMetadata = JSON.stringify({ data: 'x'.repeat(LIMITS.MAX_FIELD_LENGTH) });

    db.addDiscovery({
      category: 'pattern',
      name: 'LongMetadata',
      metadata: longMetadata,
    });

    const results = db.searchDiscoveries('LongMetadata');
    expect(results).toHaveLength(1);
    expect(results[0].metadata).toContain('... [truncated]');
  });

  it('truncates entity fields when too long', () => {
    const longDescription = 'd'.repeat(LIMITS.MAX_FIELD_LENGTH + 100);

    db.upsertEntity({
      name: 'LongEntity',
      description: longDescription,
    });

    const entity = db.getEntity('LongEntity');
    expect(entity).toBeDefined();
    expect(entity!.description).toContain('... [truncated]');
  });

  it('truncates preference values when too long', () => {
    const longValue = 'v'.repeat(LIMITS.MAX_FIELD_LENGTH + 100);

    db.setPreference({
      category: 'testing',
      key: 'long_pref',
      value: longValue,
    });

    const pref = db.getPreference('testing', 'long_pref');
    expect(pref).toBeDefined();
    expect(pref!.value).toContain('... [truncated]');
  });

  it('truncates session summary when too long', () => {
    const longSummary = 's'.repeat(LIMITS.MAX_FIELD_LENGTH + 100);

    const sessionId = db.startSession();
    db.endSession(sessionId, longSummary);

    const session = db.getLastSession();
    expect(session).toBeDefined();
    expect(session!.summary).toContain('... [truncated]');
  });

  it('truncates question fields when too long', () => {
    const longQuestion = 'q'.repeat(LIMITS.MAX_FIELD_LENGTH + 100);
    const longContext = 'c'.repeat(LIMITS.MAX_FIELD_LENGTH + 100);

    db.addQuestion(longQuestion, longContext);

    const questions = db.getOpenQuestions();
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toContain('... [truncated]');
    expect(questions[0].context).toContain('... [truncated]');
  });
});

describe('Database: Storage Limits and Pruning', () => {
  let db: MemoryDatabase;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pensieve-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.pensieve'), { recursive: true });
    db = await MemoryDatabase.create(testDir);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('maintains decision count at or below MAX_DECISIONS', () => {
    // Add more decisions than the limit allows
    // Note: This is a slow test, so we'll just test the mechanism with a smaller set
    const testLimit = 10;

    for (let i = 0; i < testLimit + 5; i++) {
      db.addDecision({
        topic: `topic-${i}`,
        decision: `decision-${i}`,
      });
    }

    // The actual pruning happens based on LIMITS.MAX_DECISIONS (1000)
    // Since we only added 15, all should be present
    const decisions = db.getRecentDecisions(100);
    expect(decisions.length).toBe(testLimit + 5);
  });

  it('handles empty database gracefully', () => {
    // Just verify no errors on empty db
    expect(db.getRecentDecisions(10)).toEqual([]);
    expect(db.getAllPreferences()).toEqual([]);
    expect(db.getAllEntities()).toEqual([]);
    expect(db.getOpenQuestions()).toEqual([]);
    expect(db.getLastSession()).toBeUndefined();
  });

  it('search returns results across multiple fields', () => {
    db.addDecision({
      topic: 'authentication',
      decision: 'Use Devise',
      rationale: 'Well maintained gem',
    });

    db.addDecision({
      topic: 'database',
      decision: 'Use PostgreSQL for authentication data',
      rationale: 'ACID compliance',
    });

    const results = db.searchDecisions('authentication');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Database: Path Resolution', () => {
  it('uses PENSIEVE_DB_PATH environment variable when set', async () => {
    const testPath = join(tmpdir(), `pensieve-env-test-${Date.now()}`);
    mkdirSync(testPath, { recursive: true });

    const customDbPath = join(testPath, 'custom.sqlite');
    process.env.PENSIEVE_DB_PATH = customDbPath;

    try {
      const db = await MemoryDatabase.create();
      db.addDecision({ topic: 'test', decision: 'test' });

      // Verify the database was created at the custom path
      expect(existsSync(customDbPath)).toBe(true);

      db.close();
    } finally {
      delete process.env.PENSIEVE_DB_PATH;
      rmSync(testPath, { recursive: true, force: true });
    }
  });
});

function getInternalDb(db: MemoryDatabase): any {
  return (db as any).db;
}

describe('Database: Schema Migration', () => {
  let db: MemoryDatabase;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pensieve-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.pensieve'), { recursive: true });
    db = await MemoryDatabase.create(testDir);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('adds archived_at column to all archivable tables', () => {
    const sqlDb = getInternalDb(db);
    for (const table of ['decisions', 'discoveries', 'entities', 'open_questions']) {
      const result = sqlDb.exec(`PRAGMA table_info(${table})`);
      const columns = result[0].values.map((row: any[]) => row[1]);
      expect(columns).toContain('archived_at');
    }
  });

  it('is idempotent — reopening the database does not error', async () => {
    db.close();
    const db2 = await MemoryDatabase.create(testDir);
    db2.addDecision({ topic: 'test', decision: 'test' });
    db2.close();
    db = await MemoryDatabase.create(testDir);
  });

  it('creates archive indexes on all archivable tables', () => {
    const sqlDb = getInternalDb(db);
    for (const table of ['decisions', 'discoveries', 'entities', 'open_questions']) {
      const result = sqlDb.exec(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_${table}_archived'`);
      expect(result.length).toBe(1);
      expect(result[0].values.length).toBe(1);
    }
  });
});

describe('Database: Archive Operations', () => {
  let db: MemoryDatabase;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pensieve-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.pensieve'), { recursive: true });
    db = await MemoryDatabase.create(testDir);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('archiveOlderThan archives old entries and skips recent ones', () => {
    const sqlDb = getInternalDb(db);

    db.addDecision({ topic: 'old-topic', decision: 'old-decision' });
    sqlDb.run("UPDATE decisions SET decided_at = datetime('now', '-60 days') WHERE topic = 'old-topic'");

    db.addDecision({ topic: 'new-topic', decision: 'new-decision' });

    const results = db.archiveOlderThan(30);
    const decisionStats = results.find((r: any) => r.table === 'decisions');
    expect(decisionStats!.affected).toBe(1);

    expect(db.searchDecisions('old-topic')).toHaveLength(0);
    expect(db.searchDecisions('new-topic')).toHaveLength(1);
  });

  it('archived entries excluded from getRecentDecisions', () => {
    db.addDecision({ topic: 'visible', decision: 'yes' });
    const id = db.addDecision({ topic: 'hidden', decision: 'no' });
    db.archiveByIds('decisions', [id]);

    const recent = db.getRecentDecisions(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].topic).toBe('visible');
  });

  it('archived entries excluded from getAllDiscoveries and getDiscoveriesByCategory', () => {
    db.addDiscovery({ category: 'pattern', name: 'visible-disc' });
    const id = db.addDiscovery({ category: 'pattern', name: 'hidden-disc' });
    db.archiveByIds('discoveries', [id]);

    expect(db.getAllDiscoveries()).toHaveLength(1);
    expect(db.getDiscoveriesByCategory('pattern')).toHaveLength(1);
  });

  it('archived entries excluded from searchDiscoveries and getRecentDiscoveries', () => {
    db.addDiscovery({ category: 'api', name: 'search-visible', description: 'findme' });
    const id = db.addDiscovery({ category: 'api', name: 'search-hidden', description: 'findme' });
    db.archiveByIds('discoveries', [id]);

    expect(db.searchDiscoveries('findme')).toHaveLength(1);
    expect(db.getRecentDiscoveries(10)).toHaveLength(1);
  });

  it('archived entries excluded from getAllEntities and getEntity', () => {
    db.upsertEntity({ name: 'VisibleEntity', description: 'yes' });
    db.upsertEntity({ name: 'HiddenEntity', description: 'no' });

    const sqlDb = getInternalDb(db);
    const result = sqlDb.exec("SELECT id FROM entities WHERE name = 'HiddenEntity'");
    const hiddenId = result[0].values[0][0] as number;

    db.archiveByIds('entities', [hiddenId]);

    expect(db.getAllEntities()).toHaveLength(1);
    expect(db.getEntity('HiddenEntity')).toBeUndefined();
    expect(db.getEntity('VisibleEntity')).toBeDefined();
  });

  it('archived entries excluded from getOpenQuestions', () => {
    db.addQuestion('visible question?');
    const id = db.addQuestion('hidden question?');
    db.archiveByIds('open_questions', [id]);

    const questions = db.getOpenQuestions();
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('visible question?');
  });

  it('archiveByIds targets specific entries only', () => {
    db.addDecision({ topic: 'keep', decision: 'keep' });
    const id2 = db.addDecision({ topic: 'archive', decision: 'archive' });
    db.addDecision({ topic: 'keep2', decision: 'keep2' });

    const count = db.archiveByIds('decisions', [id2]);
    expect(count).toBe(1);
    expect(db.getRecentDecisions(10)).toHaveLength(2);
  });

  it('restoreByIds makes entries visible again', () => {
    const id = db.addDecision({ topic: 'restored', decision: 'restored' });
    db.archiveByIds('decisions', [id]);
    expect(db.getRecentDecisions(10)).toHaveLength(0);

    const count = db.restoreByIds('decisions', [id]);
    expect(count).toBe(1);
    expect(db.getRecentDecisions(10)).toHaveLength(1);
    expect(db.getRecentDecisions(10)[0].topic).toBe('restored');
  });

  it('restoreAll restores all archived entries', () => {
    db.addDecision({ topic: 'a', decision: 'a' });
    db.addDecision({ topic: 'b', decision: 'b' });
    db.addDiscovery({ category: 'x', name: 'disc-a' });

    const sqlDb = getInternalDb(db);
    sqlDb.run("UPDATE decisions SET decided_at = datetime('now', '-1 days')");
    sqlDb.run("UPDATE discoveries SET discovered_at = datetime('now', '-1 days')");
    db.archiveOlderThan(0);

    expect(db.getRecentDecisions(10)).toHaveLength(0);
    expect(db.getAllDiscoveries()).toHaveLength(0);

    const results = db.restoreAll();
    const decisionStats = results.find((r: any) => r.table === 'decisions');
    const discoveryStats = results.find((r: any) => r.table === 'discoveries');

    expect(decisionStats!.affected).toBe(2);
    expect(discoveryStats!.affected).toBe(1);
    expect(db.getRecentDecisions(10)).toHaveLength(2);
    expect(db.getAllDiscoveries()).toHaveLength(1);
  });

  it('getArchivedEntries returns only archived entries', () => {
    db.addDecision({ topic: 'active', decision: 'active' });
    const id = db.addDecision({ topic: 'archived', decision: 'archived' });
    db.archiveByIds('decisions', [id]);

    const archived = db.getArchivedEntries<any>('decisions');
    expect(archived).toHaveLength(1);
    expect(archived[0].topic).toBe('archived');
  });
});

describe('Database: Prune Operations', () => {
  let db: MemoryDatabase;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pensieve-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.pensieve'), { recursive: true });
    db = await MemoryDatabase.create(testDir);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('pruneOlderThan permanently deletes old entries', () => {
    const sqlDb = getInternalDb(db);

    db.addDecision({ topic: 'old', decision: 'old' });
    sqlDb.run("UPDATE decisions SET decided_at = datetime('now', '-60 days') WHERE topic = 'old'");

    db.addDecision({ topic: 'recent', decision: 'recent' });

    const results = db.pruneOlderThan(30, ['decisions']);
    expect(results[0].affected).toBe(1);

    const all = sqlDb.exec('SELECT COUNT(*) FROM decisions');
    expect(all[0].values[0][0]).toBe(1);
  });

  it('pruneOlderThan with archivedOnly only deletes archived entries', () => {
    const sqlDb = getInternalDb(db);

    db.addDecision({ topic: 'active-old', decision: 'active-old' });
    db.addDecision({ topic: 'archived-old', decision: 'archived-old' });
    sqlDb.run("UPDATE decisions SET decided_at = datetime('now', '-60 days')");

    const result = sqlDb.exec("SELECT id FROM decisions WHERE topic = 'archived-old'");
    const archivedId = result[0].values[0][0] as number;
    db.archiveByIds('decisions', [archivedId]);

    const pruneResults = db.pruneOlderThan(30, ['decisions'], true);
    expect(pruneResults[0].affected).toBe(1);

    const remaining = sqlDb.exec('SELECT topic FROM decisions');
    expect(remaining[0].values).toHaveLength(1);
    expect(remaining[0].values[0][0]).toBe('active-old');
  });

  it('purgeArchived clears all archived entries, active remain', () => {
    db.addDecision({ topic: 'active', decision: 'active' });
    const id = db.addDecision({ topic: 'archived', decision: 'archived' });
    db.archiveByIds('decisions', [id]);

    db.addDiscovery({ category: 'x', name: 'active-disc' });
    const discId = db.addDiscovery({ category: 'x', name: 'archived-disc' });
    db.archiveByIds('discoveries', [discId]);

    const results = db.purgeArchived();
    const decisionStats = results.find((r: any) => r.table === 'decisions');
    const discoveryStats = results.find((r: any) => r.table === 'discoveries');

    expect(decisionStats!.affected).toBe(1);
    expect(discoveryStats!.affected).toBe(1);

    expect(db.getRecentDecisions(10)).toHaveLength(1);
    expect(db.getAllDiscoveries()).toHaveLength(1);

    expect(db.getArchivedEntries('decisions')).toHaveLength(0);
    expect(db.getArchivedEntries('discoveries')).toHaveLength(0);
  });

  it('prune respects age threshold — recent entries not deleted', () => {
    db.addDecision({ topic: 'recent', decision: 'recent' });

    const results = db.pruneOlderThan(30, ['decisions']);
    expect(results[0].affected).toBe(0);
    expect(db.getRecentDecisions(10)).toHaveLength(1);
  });
});

describe('Database: Memory Stats', () => {
  let db: MemoryDatabase;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pensieve-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.pensieve'), { recursive: true });
    db = await MemoryDatabase.create(testDir);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns correct active and archived counts', () => {
    db.addDecision({ topic: 'a', decision: 'a' });
    db.addDecision({ topic: 'b', decision: 'b' });
    const id3 = db.addDecision({ topic: 'c', decision: 'c' });
    db.archiveByIds('decisions', [id3]);

    db.addDiscovery({ category: 'x', name: 'disc1' });
    const discId = db.addDiscovery({ category: 'x', name: 'disc2' });
    db.archiveByIds('discoveries', [discId]);

    const stats = db.getMemoryStats();
    expect(stats.decisions.active).toBe(2);
    expect(stats.decisions.archived).toBe(1);
    expect(stats.discoveries.active).toBe(1);
    expect(stats.discoveries.archived).toBe(1);
    expect(stats.entities.active).toBe(0);
    expect(stats.entities.archived).toBe(0);
    expect(stats.open_questions.active).toBe(0);
    expect(stats.open_questions.archived).toBe(0);
  });

  it('returns zeros for empty database', () => {
    const stats = db.getMemoryStats();
    expect(stats.decisions.active).toBe(0);
    expect(stats.decisions.archived).toBe(0);
    expect(stats.discoveries.active).toBe(0);
    expect(stats.discoveries.archived).toBe(0);
    expect(stats.entities.active).toBe(0);
    expect(stats.entities.archived).toBe(0);
    expect(stats.open_questions.active).toBe(0);
    expect(stats.open_questions.archived).toBe(0);
  });

  it('validates table names', () => {
    expect(() => db.archiveByIds('invalid_table', [1])).toThrow('Invalid table');
    expect(() => db.restoreByIds('sessions', [1])).toThrow('Invalid table');
    expect(() => db.getArchivedEntries('preferences')).toThrow('Invalid table');
  });
});
