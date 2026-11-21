import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { withDisposable } from '../src/disposable.ts';
import { reportSchema, scenarioId } from '../src/model.ts';
import type { RehearsalReport, ScenarioId } from '../src/model.ts';
import { rehearse } from '../src/rehearsal.ts';
import { reports } from '../src/reports.ts';
import { agentTaskSchema, exportTask } from '../src/task.ts';

const exec = promisify(execFile);
const byId = new Map<ScenarioId, RehearsalReport>();
const get = (id: ScenarioId) => byId.get(id)!;
let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'migrateproof-integration-')); });
afterAll(async () => { await rm(directory, { recursive: true }); });

describe('Actual PostgreSQL rehearsals', () => {
  it.each(scenarioId.options)('records verifiable fixture evidence for %s', async id => {
    const report = await rehearse(id);
    byId.set(id, report);
    expect(reportSchema.parse(report).verification.passed).toBe(true);
    expect(report.postgresVersion).toMatch(/^17\./);
    expect(report.proposed.setup.map(step => step.status)).toEqual(['ok', 'ok']);
    expect(report.dataClassification).toBe('synthetic-demo');
    expect(report.review).toMatchObject({ required: true, status: 'pending' });
    expect(report.confirmedFailures).toHaveLength(1);
    expect(report.source.baselineSha256).toHaveLength(64);
    await reports(directory).save(report);
  }, 45000);

  it('identifies the legacy query failure and preserves the read/write contract', () => {
    const report = get('column-rename');
    expect(report.proposed.disposition).toBe('committed');
    expect(report.proposed.after.compatibility[0]).toMatchObject({
      passed: false, execution: { sqlState: '42703', sql: 'SELECT display_name FROM customers WHERE id = 1' },
    });
    expect(report.correction?.after.compatibility.map(check => check.passed)).toEqual([true, true, true]);
    expect(report.correction?.after.compatibility.at(-1)?.rows).toEqual([{ full_name: 'Demo Updated' }]);
  });

  it('detects nulls, backfills the intended rows and verifies rejected writes', () => {
    const report = get('not-null');
    expect(report.proposed.baseline.integrity[1]?.rows).toEqual([{ id: 2 }, { id: 3 }]);
    expect(report.proposed.migration.sqlState).toBe('23502');
    expect(report.proposed.after.schema).toEqual(report.proposed.baseline.schema);
    expect(report.correction?.after.integrity.at(-1)).toMatchObject({ passed: true, execution: { sqlState: '23502' } });
  });

  it('identifies both duplicate IDs and verifies the corrected uniqueness rule', () => {
    const report = get('unique-conflict');
    expect(report.proposed.migration.sqlState).toBe('23505');
    expect(report.proposed.baseline.integrity[1]?.rows).toEqual([{ alias: 'alpha', ids: [1, 2] }]);
    expect(report.correction?.after.integrity.at(-1)).toMatchObject({ passed: true, execution: { sqlState: '23505' } });
  });

  it('records actual EXPLAIN evidence and the change in accessed buffers', () => {
    const report = get('performance');
    const { baseline, after } = report.proposed;
    expect(after.plan?.rootNode).toBe('Seq Scan');
    expect(after.plan!.sharedBlocks).toBeGreaterThan(baseline.plan!.sharedBlocks);
    expect(after.plan!.executionMs).toBeGreaterThanOrEqual(0);
    expect(after.plan?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ Plan: expect.any(Object) })]));
    expect(report.correction!.after.plan!.sharedBlocks).toBeLessThan(after.plan!.sharedBlocks);
  });

  it('observes an independent blocker, rolls back and verifies retry', () => {
    const report = get('lock-contention');
    expect(report.proposed.migration).toMatchObject({ status: 'error', sqlState: '55P03' });
    expect(report.proposed.migration.elapsedMs).toBeLessThan(6500);
    expect(report.proposed.disposition).toBe('rolled-back');
    expect(report.proposed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ passed: true, rows: [expect.objectContaining({ expected_blocker: true, wait_event_type: 'Lock' })] }),
    ]));
    expect(report.correction?.disposition).toBe('committed');
  });

  it('captures the lost values and requires a recovery review', () => {
    const report = get('irreversible-drop');
    expect(report.proposed.baseline.integrity[1]?.rows).toEqual([{ total: 2 }]);
    expect(report.proposed.after.integrity[1]?.execution.sqlState).toBe('42703');
    expect(report.correction).toBeNull();
    expect(report.review.reason).toMatch(/cannot recover/);
  });
});

describe('Real evidence and database isolation', () => {
  it('reads and exports the same stored evidence through Fastify', async () => {
    const store = reports(directory);
    const api = createApi(store);
    try {
      const report = get('lock-contention');
      expect((await api.inject('/runs')).json()).toHaveLength(6);
      expect((await api.inject(`/runs/${report.id}`)).json()).toEqual(report);
      const task = agentTaskSchema.parse((await api.inject(`/runs/${report.id}/task`)).json());
      expect(task).toEqual(exportTask(report));
      expect(task.provenance.baselineSha256).toBe(report.source.baselineSha256);
      expect(task.stage).toBe('investigation');
    } finally {
      await api.close();
    }
  });

  it('uses a Unix socket and restricted role and enforces statement cancellation', async () => {
    await withDisposable(async lab => {
      const client = await lab.connect('proposed');
      try {
        const { rows } = await client.query(
          'SELECT inet_server_addr() AS addr, rolsuper, rolcreaterole, rolcreatedb, rolreplication FROM pg_roles WHERE rolname = current_user',
        );
        expect(rows[0]).toEqual({ addr: null, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
        await expect(client.query('CREATE ROLE unauthorized_demo')).rejects.toMatchObject({ code: '42501' });
        await client.query("SET statement_timeout = '100ms'");
        await expect(client.query('SELECT pg_sleep(1)')).rejects.toMatchObject({ code: '57014' });
        expect((await client.query('SELECT 1 AS healthy')).rows).toEqual([{ healthy: 1 }]);
      } finally {
        await client.end();
      }
    });
  }, 45000);

  it('preserves a detected failure and returns the documented CLI exit code', async () => {
    const env = { ...process.env, MIGRATEPROOF_REPORT_DIR: directory };
    const output = await exec(process.execPath, ['src/cli.ts', 'rehearse', 'column-rename'], { env })
      .catch((error: Error & { code: number; stdout: string }) => error);
    expect(output).toMatchObject({ code: 1 });
    const [result] = JSON.parse(output.stdout);
    const exported = await exec(process.execPath, ['src/cli.ts', 'report', result.runId], { env });
    const task = await exec(process.execPath, ['src/cli.ts', 'task', result.runId], { env });
    expect(reportSchema.parse(JSON.parse(exported.stdout)).confirmedFailures[0]?.sqlState).toBe('42703');
    expect(agentTaskSchema.parse(JSON.parse(task.stdout)).provenance.runId).toBe(result.runId);
  }, 45000);
});
