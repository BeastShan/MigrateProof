import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';

const exec = promisify(execFile);
export const postgresImage = 'postgres:17-bookworm@sha256:837bed18782820fe967067cb5328b02b0d9992c1be9a37ee0c9c492cfc03af3b';
const dockerSocket = 'unix:///var/run/docker.sock';
const forbiddenConnectionEnv = [
  'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'MIGRATEPROOF_DATABASE_URL',
  'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE',
  'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS',
];

export function rejectExternalDatabase(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (forbiddenConnectionEnv.some(key => env[key])) {
    throw new Error('External database settings are forbidden. Unset database connection variables before running the lab.');
  }
}

function docker(args: string[], timeout: number) {
  const env = { ...process.env };
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  return exec('docker', ['--host', dockerSocket, ...args], { env, timeout, maxBuffer: 64 * 1024 });
}

type Database = 'proposed' | 'correction';
export type Lab = {
  version: string;
  connect(database: Database): Promise<Client>;
};

async function connect(socket: string, database: Database | 'postgres', user: 'postgres' | 'migrateproof') {
  const client = new Client({
    host: socket, port: 5432, database, user, ssl: false, password: randomUUID(),
    options: '-c search_path=public,pg_catalog -c statement_timeout=5000 -c lock_timeout=750',
    application_name: 'migrateproof', connectionTimeoutMillis: 2000, query_timeout: 6500,
  });
  // A disconnected backend is surfaced through the next query rather than throwing an uncaught event.
  client.on('error', () => {});
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

export async function withDisposable<T>(work: (lab: Lab) => Promise<T>, signal?: AbortSignal): Promise<T> {
  rejectExternalDatabase();
  signal?.throwIfAborted();
  const name = `migrateproof-${randomUUID()}`;
  // Short private paths also fit PostgreSQL's Unix socket path-length limit.
  const directory = await mkdtemp('/tmp/migrateproof-');
  const socket = `${directory}/s`;
  let launchAttempted = false;
  let launched = false;
  try {
    await mkdir(socket);
    await chmod(socket, 0o777);
    launchAttempted = true;
    try {
      await docker([
        'run', '--detach', '--rm', '--name', name, '--label', 'org.migrateproof.disposable=true',
        '--pull', 'never', '--network', 'none', '--memory', '384m', '--cpus', '1',
        '--pids-limit', '96', '--security-opt', 'no-new-privileges',
        '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
        '--mount', `type=bind,source=${socket},target=/socket`,
        '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=reject',
        postgresImage, '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/var/run/postgresql,/socket',
        '-c', 'statement_timeout=5000', '-c', 'lock_timeout=750',
        '-c', 'idle_in_transaction_session_timeout=4000', '-c', 'max_connections=12',
        '-c', 'max_parallel_workers_per_gather=0', '-c', 'log_min_error_statement=panic',
      ], 20000);
      launched = true;
    } catch {
      throw new Error('Could not launch the pinned local PostgreSQL container. Check Docker access, image availability, and resource limits.');
    }

    let admin: Client | undefined;
    const deadline = Date.now() + 15000;
    while (!admin && Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        // The Docker entrypoint briefly starts a bootstrap server before exec'ing the real server.
        await docker(['exec', name, 'sh', '-c', 'test "$(cat /proc/1/comm)" = postgres'], 1800);
        admin = await connect(socket, 'postgres', 'postgres');
      } catch {
        await delay(150, undefined, { signal });
      }
    }
    if (!admin) throw new Error('The disposable PostgreSQL server did not become ready on its private socket.');
    let version: string;
    try {
      version = (await admin.query<{ server_version: string }>('SHOW server_version')).rows[0]!.server_version;
      await admin.query('CREATE ROLE migrateproof LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
      await admin.query('CREATE DATABASE proposed OWNER migrateproof TEMPLATE template0');
      await admin.query('CREATE DATABASE correction OWNER migrateproof TEMPLATE template0');
    } finally {
      await admin.end();
    }
    signal?.throwIfAborted();
    return await work({ version, connect: database => connect(socket, database, 'migrateproof') });
  } finally {
    try {
      if (launchAttempted) {
        const stopped = await docker(['rm', '--force', name], 10000).then(
          () => true,
          () => docker(['ps', '-aq', '--filter', `name=^/${name}$`], 5000)
            .then(({ stdout }) => stdout.trim() === '', () => false),
        );
        if (!stopped && launched) throw new Error(`Could not confirm container cleanup for ${name}.`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
