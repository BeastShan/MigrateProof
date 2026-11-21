import { z } from 'zod';
import { reportSchema, runId } from '../../../../src/model.ts';
import { agentTaskSchema } from '../../../../src/task.ts';
import { readBackend } from '../../../backend';

const params = z.object({ id: runId, artifact: z.enum(['report', 'task']) });
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string; artifact: string }> }) {
  const parsed = params.safeParse(await context.params);
  if (!parsed.success) return new Response('Invalid artifact.', { status: 404 });
  const { id, artifact } = parsed.data;
  try {
    const response = await readBackend(`/runs/${id}${artifact === 'task' ? '/task' : ''}`);
    if (response.status === 404) return new Response('Report not found.', { status: 404 });
    if (!response.ok) throw new Error('Evidence API is unavailable.');
    const content = (artifact === 'task' ? agentTaskSchema : reportSchema).parse(await response.json());
    return new Response(`${JSON.stringify(content, null, 2)}\n`, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="migrateproof-${artifact}-${id}.json"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response('Evidence API is unavailable.', { status: 502 });
  }
}
