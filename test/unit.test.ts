import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { analyzeSql, maxSqlBytes } from '../src/analyzer.ts';
import { createApi } from '../src/api.ts';
import { apiPort } from '../src/api-port.ts';
import { rejectExternalDatabase } from '../src/disposable.ts';
import { reportSchema, scenarioId } from '../src/model.ts';
import { readTextFile, reports } from '../src/reports.ts';
import { loadScenario } from '../src/scenarios.ts';
import { agentTaskSchema, DisabledAgentProvider } from '../src/task.ts';

const exec = promisify(execFile);
const cases = [
  ['DROP TABLE important;', 'DROP_TABLE'],
  ['ALTER TABLE "Example" DROP COLUMN "Case";', 'DROP_COLUMN'],
  ['ALTER TABLE sample ALTER COLUMN id TYPE bigint;', 'TYPE_CONVERSION'],
  ['ALTER TABLE t ALTER COLUMN state SET NOT NULL;', 'NOT_NULL_VALIDATION'],
  ['ALTER TABLE t ADD CONSTRAINT t_k UNIQUE (key);', 'CONSTRAINT_CHANGE'],
  ['CREATE UNIQUE INDEX sample_x ON sample (key);', 'INDEX_CHANGE'],
  ['DROP INDEX CONCURRENTLY old_idx;', 'INDEX_DROP'],
  ['UPDATE sample SET x = 1 WHERE x IS NULL;', 'BACKFILL_VALIDATION'],
  ['ALTER TABLE a RENAME COLUMN old TO new;', 'QUERY_COMPATIBILITY'],
  ['LOCK TABLE a IN ACCESS EXCLUSIVE MODE;', 'LOCKING'],
  ['SET statement_timeout = 0;', 'TIMEOUT_REVIEW'],
  ['ALTER TABLE a DISABLE TRIGGER ALL;', 'ALTER_BEHAVIOR'],
  ['TRUNCATE sample;', 'ROLLBACK_REVIEW'],
  ['WITH removed AS (DELETE FROM t RETURNING id) SELECT * FROM removed;', 'DATA_REMOVAL'],
] as const;

describe('PostgreSQL static analysis', () => {
  it.each(cases)('classifies %s', async (sql, code) => {
    const result = await analyzeSql(sql);
    expect(result.risks.map(risk => risk.code)).toContain(code);
  });

  it('ignores SQL-like text in comments and strings and labels assumptions', async () => {
    const result = await analyzeSql("/* DROP TABLE sample */ SELECT $$ALTER TABLE t DROP COLUMN a$$;");
    expect(result.risks).toEqual([]);
    expect(result.statementCount).toBe(1);
    expect(result.unverifiedAssumptions.join(' ')).toMatch(/no production safety guarantee/);
  });

  it('attributes risk once per statement with the correct ordinal', async () => {
    const result = await analyzeSql('SELECT 1; ALTER TABLE t ALTER COLUMN x SET NOT NULL, ALTER COLUMN y SET NOT NULL;');
    expect(result.statementCount).toBe(2);
    expect(result.risks.filter(risk => risk.code === 'NOT_NULL_VALIDATION')).toEqual([
      expect.objectContaining({ statement: 2, category: 'structural-risk' }),
    ]);
  });

  it.each(['-- comment only', 'ALTER TABLE', 'SELECT 1;\0', 'x'.repeat(maxSqlBytes + 1)])('rejects invalid SQL input %#', async sql => {
    await expect(analyzeSql(sql)).rejects.toThrow();
  });

  it.each(scenarioId.options)('loads and classifies %s', async id => {
    const { summary, seedSql, correctionSql } = await loadScenario(id);
    expect(summary.id).toBe(id);
    expect(summary.analysis.risks.length).toBeGreaterThan(0);
    expect(seedSql).toMatch(/INSERT INTO/);
    expect(summary.correctionAvailable).toBe(correctionSql !== null);
  });
});

describe('Boundary and input validation', () => {
  it.each(['DATABASE_URL', 'PGHOST', 'PGSERVICE', 'PGOPTIONS', 'PGPASSWORD'])('rejects %s before connecting', key => {
    expect(() => rejectExternalDatabase({ [key]: 'synthetic-setting' })).toThrow(/forbidden/);
  });

  it('accepts a clean configuration and rejects invalid API ports', () => {
    expect(() => rejectExternalDatabase({})).not.toThrow();
    const prior = process.env.MIGRATEPROOF_API_PORT;
    try {
      process.env.MIGRATEPROOF_API_PORT = '4301';
      expect(apiPort()).toBe(4301);
      process.env.MIGRATEPROOF_API_PORT = '65536';
      expect(() => apiPort()).toThrow();
    } finally {
      if (prior === undefined) delete process.env.MIGRATEPROOF_API_PORT;
      else process.env.MIGRATEPROOF_API_PORT = prior;
    }
  });

  it('rejects traversal and malformed run records', async () => {
    await expect(reports().get('../../outside')).rejects.toThrow();
    expect(reportSchema.safeParse({ id: 'bad' }).success).toBe(false);
    expect(scenarioId.safeParse('../migration').success).toBe(false);
  });

  it('bounds file reads and rejects invalid UTF-8', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migrateproof-unit-'));
    const file = join(directory, 'test.sql');
    try {
      await writeFile(file, 'SELECT 1');
      await expect(readTextFile(file, 8)).resolves.toBe('SELECT 1');
      await expect(readTextFile(file, 4)).rejects.toThrow();
      await expect(readTextFile(directory, 1024)).rejects.toThrow();
      await writeFile(file, Buffer.from([0xff, 0xfe]));
      await expect(readTextFile(file, 8)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('serves an empty inventory history and rejects invalid routes and execution requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migrateproof-api-'));
    const api = createApi(reports(directory));
    try {
      const inventory = await api.inject('/scenarios');
      expect(inventory.json()).toHaveLength(6);
      expect(inventory.headers['cache-control']).toBe('no-store');
      expect((await api.inject('/runs')).json()).toEqual([]);
      expect((await api.inject('/runs/invalid')).statusCode).toBe(400);
      expect((await api.inject('/runs/10000000-0000-4000-8000-000000000000/task')).statusCode).toBe(404);
      expect((await api.inject({ method: 'POST', url: '/runs', payload: { sql: 'SELECT 1' } })).statusCode).toBe(404);
    } finally {
      await api.close();
      await rm(directory, { recursive: true });
    }
  });

  it('CLI rejects invalid commands and external targets with operational exit code 2', async () => {
    await expect(exec(process.execPath, ['src/cli.ts', 'rehearse', 'unknown'])).rejects.toMatchObject({ code: 2 });
    await expect(exec(process.execPath, ['src/cli.ts', 'init', '--database-url', 'postgres://example.invalid/test'])).rejects.toMatchObject({ code: 2 });
    await expect(exec(process.execPath, ['src/cli.ts', 'init'], {
      env: { ...process.env, DATABASE_URL: 'postgres://example.invalid/test' },
    })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('External database settings are forbidden') });
  });
});

describe('Provider boundary', () => {
  it('keeps provider start, status, and cancellation disabled', async () => {
    const provider = new DisabledAgentProvider();
    await expect(provider.start()).rejects.toThrow('disabled');
    await expect(provider.status()).rejects.toThrow('disabled');
    await expect(provider.cancel()).rejects.toThrow('disabled');
  });

  it('rejects unapproved repair and independent verification payloads', () => {
    const body = {
      version: 1, title: 'Synthetic task', humanReviewRequired: true,
      scope: ['approved work only'], evidence: [], acceptanceCriteria: ['repeatable evidence'],
      provenance: {
        runId: '10000000-0000-4000-8000-000000000000', scenarioId: 'not-null',
        baselineSha256: 'f'.repeat(64), proposedSha256: 'f'.repeat(64), postgresVersion: '17', postgresImage: 'sample',
      },
    };
    expect(agentTaskSchema.safeParse({ ...body, stage: 'investigation' }).success).toBe(true);
    expect(agentTaskSchema.safeParse({ ...body, stage: 'repair' }).success).toBe(false);
    expect(agentTaskSchema.safeParse({ ...body, stage: 'independent-verification' }).success).toBe(false);
  });
});
