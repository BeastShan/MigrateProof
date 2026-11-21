import { z } from 'zod';

export const scenarioId = z.enum([
  'column-rename', 'not-null', 'unique-conflict', 'performance', 'lock-contention', 'irreversible-drop',
]);
export type ScenarioId = z.infer<typeof scenarioId>;
export const runId = z.uuid();
export const sha256 = z.hash('sha256');
export const severity = z.enum(['low', 'medium', 'high', 'critical']);
export const structuralRisk = z.object({
  code: z.string(),
  category: z.enum(['structural-risk', 'potential-risk']),
  severity,
  statement: z.number().int().positive(),
  explanation: z.string(),
});
export type StructuralRisk = z.infer<typeof structuralRisk>;
export const analysis = z.object({
  statementCount: z.number().int().positive(),
  risks: z.array(structuralRisk),
  unverifiedAssumptions: z.array(z.string()),
});
const execution = z.object({
  label: z.string(), sql: z.string(), status: z.enum(['ok', 'error']),
  elapsedMs: z.number().nonnegative(),
  commands: z.array(z.object({ command: z.string(), rowCount: z.number().nullable() })),
  sqlState: z.string().nullable(),
  detail: z.string().nullable(),
});
const check = z.object({
  name: z.string(),
  passed: z.boolean(),
  expectedSqlState: z.string().nullable(),
  execution,
  rows: z.array(z.record(z.string(), z.json())),
});
const snapshot = z.object({
  schema: z.array(z.record(z.string(), z.json())),
  compatibility: z.array(check),
  integrity: z.array(check),
  plan: z.object({
    execution,
    evidence: z.json(),
    rootNode: z.string(),
    sharedBlocks: z.number().nonnegative(),
    executionMs: z.number().nonnegative(),
  }).nullable(),
});
const attempt = z.object({
  setup: z.array(execution),
  baseline: snapshot,
  migration: execution,
  disposition: z.enum(['committed', 'rolled-back']),
  diagnostics: z.array(check),
  after: snapshot,
});
export const scenarioSummary = z.object({
  id: scenarioId,
  title: z.string(), description: z.string(),
  correctionAvailable: z.boolean(),
  analysis,
});
export const reportSchema = z.object({
  version: z.literal(1),
  id: runId,
  scenario: scenarioSummary,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  dataClassification: z.literal('synthetic-demo'),
  postgresVersion: z.string(),
  postgresImage: z.string(),
  source: z.object({
    schemaSql: z.string(), seedSql: z.string(),
    baselineSha256: sha256,
    proposedSha256: sha256,
    correctionSha256: sha256.nullable(),
  }),
  proposed: attempt,
  correction: attempt.nullable(),
  confirmedFailures: z.array(z.object({
    code: z.string(), evidence: z.string(), sqlState: z.string().nullable(),
  })),
  verification: z.object({ passed: z.boolean(), expectation: z.string() }),
  review: z.object({
    required: z.literal(true),
    status: z.literal('pending'),
    reason: z.string(),
  }),
  followUp: z.array(z.string()),
});
export type RehearsalReport = z.infer<typeof reportSchema>;
export type Attempt = z.infer<typeof attempt>;
export type Snapshot = z.infer<typeof snapshot>;
export type Execution = z.infer<typeof execution>;
export type Check = z.infer<typeof check>;

export const reportSummary = reportSchema.pick({
  id: true, completedAt: true, scenario: true, verification: true, confirmedFailures: true, review: true,
});
