import Fastify from 'fastify';
import { z } from 'zod';
import { runId, scenarioId } from './model.ts';
import { reports } from './reports.ts';
import { loadScenario } from './scenarios.ts';
import { exportTask } from './task.ts';

const idParams = z.object({ id: runId }).strict();

export function createApi(store = reports()) {
  const api = Fastify({ logger: false, exposeHeadRoutes: false });
  api.setErrorHandler((_error, _request, reply) => {
    reply.code(500).send({ error: 'Unable to load local rehearsal evidence.' });
  });
  api.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });
  api.get('/health', async () => ({ status: 'ok' }));
  api.get('/scenarios', async () => Promise.all(scenarioId.options.map(async id => (await loadScenario(id)).summary)));
  api.get('/runs', async () => store.list());
  for (const endpoint of ['/runs/:id', '/runs/:id/task'] as const) {
    api.get(endpoint, async (request, reply) => {
      const params = idParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid report identifier.' });
      const report = await store.get(params.data.id);
      if (!report) return reply.code(404).send({ error: 'Report not found.' });
      return endpoint.endsWith('/task') ? exportTask(report) : report;
    });
  }
  return api;
}
