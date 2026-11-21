import { createApi } from './api.ts';
import { apiPort } from './api-port.ts';

const api = createApi();
try {
  const address = await api.listen({ host: '127.0.0.1', port: apiPort() });
  console.log(`MigrateProof API listening at ${address}`);
} catch {
  console.error('Could not start the MigrateProof API on its loopback port.');
  process.exitCode = 2;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void api.close().catch(() => { process.exitCode = 2; }));
}
