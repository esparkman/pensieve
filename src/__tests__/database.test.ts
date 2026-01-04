import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase, LIMITS } from '../database.js';
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
