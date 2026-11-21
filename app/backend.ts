import { z } from 'zod';
import { apiPort } from '../src/api-port.ts';
import { reportSchema, reportSummary, scenarioSummary } from '../src/model.ts';

export async function readBackend(path: string) {
  return fetch(`http://127.0.0.1:${apiPort()}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(3500) });
}

async function read<T>(path: string, schema: z.ZodType<T>) {
  const response = await readBackend(path);
  if (!response.ok) throw new Error('Local evidence API unavailable.');
  return schema.parse(await response.json());
}

export async function inventory() {
  const [scenarios, runs] = await Promise.all([read('/scenarios', z.array(scenarioSummary)), read('/runs', z.array(reportSummary))]);
  return { scenarios, runs };
}

export async function rehearsal(id: string) {
  const response = await readBackend(`/runs/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Local evidence API unavailable.');
  return reportSchema.parse(await response.json());
}
