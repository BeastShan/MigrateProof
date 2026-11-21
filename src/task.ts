import { z } from 'zod';
import { runId, scenarioId, sha256 } from './model.ts';
import type { RehearsalReport } from './model.ts';

const common = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(180),
  provenance: z.object({
    runId, scenarioId, baselineSha256: sha256, proposedSha256: sha256,
    postgresVersion: z.string(), postgresImage: z.string(),
  }),
  scope: z.array(z.string()).min(1),
  evidence: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()).min(1),
  humanReviewRequired: z.literal(true),
});
const approvalReference = z.object({
  approvalId: z.string().min(1).max(128),
  approvedCommit: z.hash('sha1'),
});
export const agentTaskSchema = z.discriminatedUnion('stage', [
  common.extend({ stage: z.literal('investigation') }),
  common.extend({ stage: z.literal('repair'), approvalReference }),
  common.extend({ stage: z.literal('independent-verification'), approvalReference, proposedCommit: z.hash('sha1') }),
]);
export type AgentTask = z.infer<typeof agentTaskSchema>;

export interface AgentProvider {
  start(task: AgentTask, request: { signal: AbortSignal; maxDurationMs: number; sessionBudgetReference: string }): Promise<{ sessionId: string }>;
  status(sessionId: string, signal: AbortSignal): Promise<{
    state: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
    resultReference?: string;
  }>;
  cancel(sessionId: string, signal: AbortSignal): Promise<void>;
}

export class DisabledAgentProvider implements AgentProvider {
  async start(): Promise<never> { throw new Error('Agent provider is disabled.'); }
  async status(): Promise<never> { throw new Error('Agent provider is disabled.'); }
  async cancel(): Promise<never> { throw new Error('Agent provider is disabled.'); }
}

export function exportTask(report: RehearsalReport): AgentTask {
  return agentTaskSchema.parse({
    version: 1,
    stage: 'investigation',
    title: `Investigate migration risk | ${report.scenario.title}`,
    provenance: {
      runId: report.id, scenarioId: report.scenario.id,
      baselineSha256: report.source.baselineSha256, proposedSha256: report.source.proposedSha256,
      postgresVersion: report.postgresVersion, postgresImage: report.postgresImage,
    },
    scope: [
      `Read the report and fixtures in scenarios/${report.scenario.id}/.`,
      'Reproduce with the pinned disposable PostgreSQL image. Use synthetic fixtures only.',
      'Inspect the migration, affected schema, and representative application queries.',
      'Return evidence and suggested scope for a separately approved repair.',
    ],
    evidence: report.confirmedFailures.map(result => `${result.code} ${result.sqlState ?? ''} ${result.evidence}`.replace(/  +/g, ' ')),
    acceptanceCriteria: [
      report.verification.expectation,
      ...report.followUp,
      'Cite reproduction commands and actual schema, compatibility, and integrity observations.',
    ],
    humanReviewRequired: true,
  });
}
