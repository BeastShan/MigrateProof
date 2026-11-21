import { readFile } from 'node:fs/promises';
import { analyzeSql } from './analyzer.ts';
import { scenarioId } from './model.ts';
import type { ScenarioId } from './model.ts';

export type Rows = Record<string, unknown>[];
export type RowCheck = { name: string; sql: string; expected: Rows; expectedSqlState?: string };
const rows = (name: string, sql: string, expected: Rows): RowCheck => ({ name, sql, expected });
const rejectedWrite = (name: string, sql: string, expectedSqlState: string): RowCheck => ({
  name, sql, expected: [], expectedSqlState,
});
const ids = (table: string, total: number) => rows('Fixture row count', `SELECT count(*)::int AS total FROM ${table}`, [{ total }]);
const noChecks: RowCheck[] = [];

type Scenario = {
  title: string;
  description: string;
  expectation: string;
  followUp: string[];
  reviewReason?: string;
  baseline: RowCheck[];
  afterProposed?: RowCheck[];
  afterCorrection?: RowCheck[];
  baselineCompatibility: RowCheck[];
  correctionCompatibility?: RowCheck[];
  expectedMigrationState?: string;
  planQuery?: string;
  contention?: boolean;
};

export const scenarios: Record<ScenarioId, Scenario> = {
  'column-rename': {
    title: 'Breaking column rename',
    description: 'Rename a customer column used by an existing query.',
    expectation: 'The rename breaks the legacy query with 42703. The generated alias preserves legacy reads and writes and supports new reads.',
    followUp: ['Inventory production consumers before changing the write contract.', 'Move writers deliberately before retiring the old column.'],
    baseline: [ids('customers', 2)],
    baselineCompatibility: [rows('Existing customer lookup', 'SELECT display_name FROM customers WHERE id = 1', [{ display_name: 'Demo Alpha' }])],
    correctionCompatibility: [
      rows('New customer lookup', 'SELECT full_name FROM customers WHERE id = 1', [{ full_name: 'Demo Alpha' }]),
      rows('Existing write propagates to new readers', "UPDATE customers SET display_name = 'Demo Updated' WHERE id = 2 RETURNING full_name", [{ full_name: 'Demo Updated' }]),
    ],
    afterProposed: [
      ids('customers', 2),
      rows('Renamed column still contains fixture values', 'SELECT full_name FROM customers ORDER BY id', [{ full_name: 'Demo Alpha' }, { full_name: 'Demo Beta' }]),
    ],
  },
  'not-null': {
    title: 'Unsafe NOT NULL constraint',
    description: 'Enforce a delivery state before filling existing null values.',
    expectation: 'PostgreSQL rejects the proposed constraint with 23502. The correction fills precisely the missing states and enforces NOT NULL.',
    followUp: ['Validate that pending is appropriate for real legacy deliveries.', 'Plan batched backfill and constraint verification for production scale.'],
    expectedMigrationState: '23502',
    baseline: [
      ids('deliveries', 3),
      rows('Rows missing a delivery state', 'SELECT id FROM deliveries WHERE state IS NULL ORDER BY id', [{ id: 2 }, { id: 3 }]),
    ],
    afterCorrection: [
      ids('deliveries', 3),
      rows('Missing states after backfill', 'SELECT id FROM deliveries WHERE state IS NULL ORDER BY id', []),
      rows('Backfilled values', 'SELECT id, state FROM deliveries ORDER BY id', [{ id: 1, state: 'sent' }, { id: 2, state: 'pending' }, { id: 3, state: 'pending' }]),
      rejectedWrite('New null state is rejected', 'INSERT INTO deliveries VALUES (4, NULL)', '23502'),
    ],
    baselineCompatibility: [rows('Existing delivery lookup', 'SELECT state FROM deliveries WHERE id = 1', [{ state: 'sent' }])],
  },
  'unique-conflict': {
    title: 'Unique constraint conflict',
    description: 'Enforce unique aliases with duplicate rows in the baseline.',
    expectation: 'PostgreSQL rejects the proposed constraint with 23505. The correction resolves the fixture duplicates and stores the unique constraint.',
    followUp: ['Agree on an alias collision policy with owners of dependent systems.', 'Check for follow-on collisions before running a real backfill.'],
    expectedMigrationState: '23505',
    baseline: [
      ids('aliases', 3),
      rows('Duplicate aliases and affected IDs',
        'SELECT alias, array_agg(id ORDER BY id) AS ids FROM aliases GROUP BY alias HAVING count(*) > 1 ORDER BY alias',
        [{ alias: 'alpha', ids: [1, 2] }]),
    ],
    afterCorrection: [
      ids('aliases', 3),
      rows('Resolved aliases by ID', 'SELECT id, alias FROM aliases ORDER BY id', [{ id: 1, alias: 'alpha' }, { id: 2, alias: 'alpha-demo-2' }, { id: 3, alias: 'beta' }]),
      rejectedWrite('New duplicate alias is rejected', "INSERT INTO aliases VALUES (4, 'alpha')", '23505'),
    ],
    baselineCompatibility: [rows('Existing alias lookup', 'SELECT alias FROM aliases WHERE id = 1', [{ alias: 'alpha' }])],
  },
  performance: {
    title: 'Query performance regression',
    description: 'Remove an index used by a selective lookup on 75,000 synthetic rows.',
    expectation: 'The proposed change replaces the indexed plan with a sequential scan and increases shared blocks accessed. The replacement index restores indexed access.',
    followUp: ['Repeat the lookup under representative distributions and concurrent load.', 'Review the replacement index’s build and write costs.'],
    baseline: [ids('events', 75000)],
    baselineCompatibility: [rows('Existing event lookup', 'SELECT id FROM events WHERE customer_id = 42424', [{ id: 42424 }])],
    planQuery: 'SELECT id FROM events WHERE customer_id = 42424',
  },
  'lock-contention': {
    title: 'Migration lock contention',
    description: 'Hold an independent lock while an ALTER TABLE operation waits.',
    expectation: 'A second session observes the blocker. PostgreSQL cancels the blocked ALTER with 55P03, the transaction rolls back, and a retry succeeds after lock release.',
    followUp: ['Schedule DDL for a short lock window and require bounded retries.', 'Capture blocker diagnostics in the deployment runbook.'],
    expectedMigrationState: '55P03',
    baseline: [ids('invoices', 2)],
    baselineCompatibility: [rows('Existing invoice lookup', 'SELECT cents FROM invoices WHERE id = 2', [{ cents: 2500 }])],
    contention: true,
  },
  'irreversible-drop': {
    title: 'Irreversible column drop',
    description: 'Drop a populated legacy column and inspect the missing data.',
    expectation: 'The DDL commits, the remaining row count is preserved, and the legacy payload becomes inaccessible with 42703.',
    followUp: ['Inventory consumers and confirm a retention policy.', 'Prove recovery from a tested archive or backup before any real drop.'],
    reviewReason: 'Recreating the column cannot recover the committed deletion of its values. Require explicit human approval and evidence of recoverability.',
    baseline: [ids('notes', 2), rows('Populated legacy values', 'SELECT count(*)::int AS total FROM notes WHERE legacy_text IS NOT NULL', [{ total: 2 }])],
    baselineCompatibility: noChecks,
  },
};

export async function loadScenario(id: ScenarioId) {
  const checked = scenarioId.parse(id);
  const definition = scenarios[checked];
  const load = (stage: string) => readFile(new URL(`../scenarios/${checked}/${stage}.sql`, import.meta.url), 'utf8');
  const [schemaSql, seedSql, proposedSql, correctionSql] = await Promise.all([
    load('schema'), load('seed'), load('proposed'), checked === 'irreversible-drop' ? null : load('correction'),
  ]);
  const summary = {
    id: checked, title: definition.title, description: definition.description,
    correctionAvailable: correctionSql !== null, analysis: await analyzeSql(proposedSql),
  };
  return { definition, summary, schemaSql, seedSql, proposedSql, correctionSql };
}
