import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { Client, QueryResult } from 'pg';
import { z } from 'zod';
import { postgresImage, withDisposable } from './disposable.ts';
import type { Lab } from './disposable.ts';
import { reportSchema } from './model.ts';
import type { Attempt, Check, Execution, RehearsalReport, ScenarioId, Snapshot } from './model.ts';
import { loadScenario } from './scenarios.ts';
import type { RowCheck } from './scenarios.ts';

const schemaSql = `
SELECT table_name AS relation, column_name AS name, data_type AS definition,
       is_nullable = 'YES' AS nullable, generation_expression AS generated
FROM information_schema.columns WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;`;
const constraintsSql = `
SELECT c.relname AS relation, con.conname AS name, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
ORDER BY c.relname, con.conname;`;
const indexesSql = `
SELECT tablename AS relation, indexname AS name, indexdef AS definition
FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;`;

const knownErrors: Record<string, string> = {
  '23502': 'Existing data violates a NOT NULL constraint.',
  '23505': 'Existing data violates a unique constraint.',
  '42703': 'The query references a column that does not exist.',
  '55P03': 'PostgreSQL canceled the statement after its lock timeout.',
  '57014': 'PostgreSQL canceled the statement, for example after its statement timeout.',
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const jsonRow = z.record(z.string(), z.json());

async function capture(client: Client, label: string, sql: string, values?: unknown[]) {
  const started = performance.now();
  try {
    const raw = await client.query(sql, values) as QueryResult | QueryResult[];
    const results = Array.isArray(raw) ? raw : [raw];
    const execution: Execution = {
      label, sql, status: 'ok', elapsedMs: performance.now() - started,
      commands: results.map(({ command, rowCount }) => ({ command, rowCount })),
      sqlState: null, detail: null,
    };
    return { execution, rows: z.array(jsonRow).parse(results.at(-1)?.rows ?? []) };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    // Omit server-provided error strings, which can expose values, paths or connection details.
    if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code) || /^08/.test(code)) {
      throw new Error('A database operation failed without a usable PostgreSQL execution result.');
    }
    const execution: Execution = {
      label, sql, status: 'error', elapsedMs: performance.now() - started, commands: [],
      sqlState: code, detail: knownErrors[code] ?? 'PostgreSQL rejected the statement. Inspect the SQLSTATE.',
    };
    return { execution, rows: [] };
  }
}

async function requireQuery(client: Client, label: string, sql: string) {
  const result = await capture(client, label, sql);
  if (result.execution.status === 'error') throw new Error(`${label} failed (${result.execution.sqlState}).`);
  return result;
}

async function checks(client: Client, group: RowCheck[]) {
  const results: Check[] = [];
  for (const { name, sql, expected, expectedSqlState } of group) {
    const result = await capture(client, name, sql);
    const passed = expectedSqlState
      ? result.execution.sqlState === expectedSqlState
      : result.execution.status === 'ok' && isDeepStrictEqual(result.rows, expected);
    results.push({ name, passed, expectedSqlState: expectedSqlState ?? null, ...result });
  }
  return results;
}

const planSchema = z.array(z.object({
  Plan: z.object({
    'Node Type': z.string(),
    'Shared Hit Blocks': z.number(),
    'Shared Read Blocks': z.number(),
  }),
  'Execution Time': z.number(),
})).min(1);

async function snapshot(client: Client, integrity: RowCheck[], compatibility: RowCheck[], planQuery?: string): Promise<Snapshot> {
  const schema = [];
  for (const [kind, sql] of [['column', schemaSql], ['constraint', constraintsSql], ['index', indexesSql]] as const) {
    const result = await requireQuery(client, 'Read schema catalog', sql);
    schema.push(...result.rows.map(record => ({ kind, ...record })));
  }
  // A fixture compatibility check can write, so collect integrity and plan evidence first.
  const integrityEvidence = await checks(client, integrity);
  let plan: Snapshot['plan'] = null;
  if (planQuery) {
    const { rows, execution } = await requireQuery(client, 'Measure lookup plan', `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${planQuery}`);
    const evidence = rows[0]?.['QUERY PLAN'] ?? null;
    const sample = planSchema.parse(evidence)[0]!;
    plan = {
      execution, evidence, rootNode: sample.Plan['Node Type'],
      sharedBlocks: sample.Plan['Shared Hit Blocks'] + sample.Plan['Shared Read Blocks'],
      executionMs: sample['Execution Time'],
    };
  }
  return { schema, integrity: integrityEvidence, compatibility: await checks(client, compatibility), plan };
}

const blockersSql = `
SELECT cardinality(pg_blocking_pids(pid)) AS blocker_count,
       $2::int = ANY(pg_blocking_pids(pid)) AS expected_blocker,
       wait_event_type, wait_event
FROM pg_stat_activity WHERE pid = $1;`;

type Loaded = Awaited<ReturnType<typeof loadScenario>>;

async function runAttempt(lab: Lab, fixture: Loaded, variant: 'proposed' | 'correction', signal?: AbortSignal): Promise<Attempt> {
  const { definition } = fixture;
  const client = await lab.connect(variant);
  let holder: Client | undefined;
  let observer: Client | undefined;
  try {
    const created = await requireQuery(client, 'Create baseline schema', fixture.schemaSql);
    const seeded = await requireQuery(client, 'Seed deterministic synthetic records', fixture.seedSql);
    const baseline = await snapshot(client, definition.baseline, definition.baselineCompatibility, definition.planQuery);
    const correction = variant === 'correction';
    const migrationSql = correction ? fixture.correctionSql! : fixture.proposedSql;
    const diagnostics: Check[] = [];
    let migration: Execution;

    signal?.throwIfAborted();
    await requireQuery(client, 'Open migration transaction', 'BEGIN');
    if (definition.contention) {
      holder = await lab.connect(variant);
      await requireQuery(holder, 'Open lock holder transaction', 'BEGIN');
      const locked = await requireQuery(holder, 'Obtain competing lock', 'LOCK TABLE invoices IN ACCESS SHARE MODE');
      diagnostics.push({ name: 'Competing session held a table lock', passed: true, expectedSqlState: null, ...locked });
      if (correction) {
        const released = await requireQuery(holder, 'Release competing lock before retry', 'ROLLBACK');
        diagnostics.push({ name: 'Competing transaction released', passed: true, expectedSqlState: null, ...released });
        migration = (await capture(client, 'Retry migration after lock release', migrationSql)).execution;
      } else {
        observer = await lab.connect(variant);
        // Read session IDs before the migration starts; queries on one client run sequentially.
        const migrationPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const holderPid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const applying = capture(client, 'Apply proposed migration while lock is held', migrationSql);
        const observing = pollBlocker(observer, migrationPid, holderPid);
        const [applied, observed] = await Promise.allSettled([applying, observing]);
        if (applied.status === 'rejected') throw applied.reason;
        if (observed.status === 'rejected') throw observed.reason;
        migration = applied.value.execution;
        diagnostics.push(observed.value);
        const released = await requireQuery(holder, 'Release competing lock', 'ROLLBACK');
        diagnostics.push({ name: 'Competing transaction released', passed: true, expectedSqlState: null, ...released });
      }
    } else {
      migration = (await capture(client, `Apply ${variant} migration`, migrationSql)).execution;
    }

    const committed = migration.status === 'ok';
    const transaction = await requireQuery(client, 'Close migration transaction', committed ? 'COMMIT' : 'ROLLBACK');
    diagnostics.push({ name: committed ? 'Transaction committed' : 'Transaction rolled back', passed: true, expectedSqlState: null, ...transaction });
    signal?.throwIfAborted();
    const after = await snapshot(
      client,
      (correction ? definition.afterCorrection : definition.afterProposed) ?? definition.baseline,
      correction ? [...definition.baselineCompatibility, ...(definition.correctionCompatibility ?? [])] : definition.baselineCompatibility,
      definition.planQuery,
    );
    return { setup: [created.execution, seeded.execution], baseline, migration, disposition: committed ? 'committed' : 'rolled-back', diagnostics, after };
  } finally {
    await Promise.allSettled([client.end(), holder?.end(), observer?.end()]);
  }
}

async function pollBlocker(observer: Client, migrationPid: number, holderPid: number): Promise<Check> {
  const deadline = Date.now() + 600;
  let result = await capture(observer, 'Observe PostgreSQL lock waiter', blockersSql, [migrationPid, holderPid]);
  const observed = () => result.rows[0]?.expected_blocker === true && result.rows[0]?.wait_event_type === 'Lock';
  while (Date.now() < deadline && !observed()) {
    await delay(25);
    result = await capture(observer, 'Observe PostgreSQL lock waiter', blockersSql, [migrationPid, holderPid]);
  }
  return { name: 'Separate session observed the expected blocker', passed: observed(), expectedSqlState: null, ...result };
}

const allPassed = (snap: Snapshot) => [...snap.integrity, ...snap.compatibility].every(result => result.passed);
const hasSchema = (snap: Snapshot, kind: string, name: string) => snap.schema.some(item => item.kind === kind && item.name === name);
const indexed = (snap: Snapshot) => snap.plan?.rootNode.includes('Index') ?? false;

function verify(fixture: Loaded, proposed: Attempt, correction: Attempt | null) {
  const { definition, summary } = fixture;
  const confirmedFailures: RehearsalReport['confirmedFailures'] = [];
  let expected = false;

  if (proposed.migration.status === 'error') {
    confirmedFailures.push({ code: 'MIGRATION_ERROR', evidence: proposed.migration.detail!, sqlState: proposed.migration.sqlState });
  }
  for (const check of proposed.after.compatibility.filter(check => !check.passed)) {
    confirmedFailures.push({ code: 'COMPATIBILITY_FAILURE', evidence: check.name, sqlState: check.execution.sqlState });
  }
  for (const check of proposed.after.integrity.filter(check => !check.passed)) {
    confirmedFailures.push({ code: 'INTEGRITY_FAILURE', evidence: check.name, sqlState: check.execution.sqlState });
  }

  if (definition.expectedMigrationState) {
    expected = proposed.migration.sqlState === definition.expectedMigrationState
      && proposed.disposition === 'rolled-back' && allPassed(proposed.after)
      && isDeepStrictEqual(proposed.baseline.schema, proposed.after.schema);
  }
  switch (summary.id) {
    case 'column-rename':
      expected = proposed.disposition === 'committed' && proposed.after.compatibility[0]?.execution.sqlState === '42703'
        && proposed.after.integrity.every(check => check.passed);
      break;
    case 'not-null':
      expected &&= correction?.after.schema.some(item => item.kind === 'column' && item.name === 'state' && item.nullable === false) ?? false;
      break;
    case 'unique-conflict':
      expected &&= !!correction && hasSchema(correction.after, 'constraint', 'aliases_alias_key');
      break;
    case 'performance': {
      const before = proposed.baseline.plan;
      const after = proposed.after.plan;
      const fixed = correction?.after.plan;
      const regressed = before && after && indexed(proposed.baseline) && after.rootNode === 'Seq Scan'
        && after.sharedBlocks > before.sharedBlocks;
      if (regressed) confirmedFailures.push({
        code: 'PLAN_REGRESSION',
        evidence: `Lookup changed from ${before.rootNode} (${before.sharedBlocks} shared blocks) to ${after.rootNode} (${after.sharedBlocks} shared blocks).`,
        sqlState: null,
      });
      expected = !!(regressed && correction && fixed && indexed(correction.after) && fixed.sharedBlocks < after.sharedBlocks)
        && proposed.disposition === 'committed' && allPassed(proposed.after);
      break;
    }
    case 'lock-contention':
      expected &&= proposed.diagnostics.every(check => check.passed) && !!correction
        && hasSchema(correction.after, 'column', 'memo');
      break;
    case 'irreversible-drop':
      expected = proposed.disposition === 'committed' && proposed.after.integrity[0]?.passed === true
        && proposed.after.integrity[1]?.execution.sqlState === '42703' && !hasSchema(proposed.after, 'column', 'legacy_text');
      break;
  }
  const fixed = correction === null || (
    allPassed(correction.baseline) && correction.disposition === 'committed' && allPassed(correction.after)
  );
  return { confirmedFailures, verification: { passed: expected && fixed && allPassed(proposed.baseline), expectation: definition.expectation } };
}

export async function rehearse(id: ScenarioId, signal?: AbortSignal): Promise<RehearsalReport> {
  const fixture = await loadScenario(id);
  const startedAt = new Date().toISOString();
  const evidence = await withDisposable(async lab => {
    const proposed = await runAttempt(lab, fixture, 'proposed', signal);
    const correction = fixture.correctionSql ? await runAttempt(lab, fixture, 'correction', signal) : null;
    return { postgresVersion: lab.version, proposed, correction, ...verify(fixture, proposed, correction) };
  }, signal);
  return reportSchema.parse({
    version: 1, id: randomUUID(), scenario: fixture.summary, startedAt, completedAt: new Date().toISOString(),
    dataClassification: 'synthetic-demo', postgresImage,
    source: {
      schemaSql: fixture.schemaSql, seedSql: fixture.seedSql, baselineSha256: hash(`${fixture.schemaSql}\0${fixture.seedSql}`),
      proposedSha256: hash(fixture.proposedSql), correctionSha256: fixture.correctionSql ? hash(fixture.correctionSql) : null,
    },
    ...evidence,
    review: {
      required: true, status: 'pending',
      reason: fixture.definition.reviewReason ?? 'Require explicit human review of the proposal, evidence and rollout plan before merge or deploy.',
    },
    followUp: fixture.definition.followUp,
  });
}
