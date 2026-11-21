import { parseArgs } from 'node:util';
import { analyzeSql, maxSqlBytes } from './analyzer.ts';
import { withDisposable } from './disposable.ts';
import { runId, scenarioId } from './model.ts';
import { readTextFile, reports } from './reports.ts';
import { rehearse } from './rehearsal.ts';
import { loadScenario } from './scenarios.ts';
import { exportTask } from './task.ts';

const usage = `Usage: npm run lab -- <command>
  list                         List all bundled scenarios and classifications
  analyze <file.sql>           Inspect a local SQL file without executing it
  init                         Start, verify, and destroy a disposable PostgreSQL lab
  rehearse <scenario-id>       Run one bundled scenario and save its JSON report
  report <run-id>              Print a saved rehearsal report as JSON
  task <run-id>                Print an investigation task as JSON
  verify                       Rehearse all scenarios and verify expected outcomes
  help                         Show this help`;

const controller = new AbortController();
let interrupted: number | undefined;
for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.once(signal, () => {
    interrupted = status;
    controller.abort(new Error('Rehearsal interrupted.'));
  });
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [command = 'help', value] = positionals;
  const needsValue = ['analyze', 'rehearse', 'report', 'task'].includes(command);
  if (positionals.length > (needsValue ? 2 : 1) || (needsValue && !value)) throw new Error(usage);
  const store = reports();
  switch (command) {
    case 'help':
      console.log(usage);
      return 0;
    case 'list':
      print(await Promise.all(scenarioId.options.map(async id => (await loadScenario(id)).summary)));
      return 0;
    case 'analyze':
      print(await analyzeSql(await readTextFile(value!, maxSqlBytes)));
      return 0;
    case 'init':
      print(await withDisposable(async ({ version }) => ({ postgresVersion: version, lifecycle: 'initialized and destroyed' }), controller.signal));
      return 0;
    case 'rehearse':
    case 'verify': {
      const ids = command === 'verify' ? scenarioId.options : [scenarioId.parse(value)];
      let failed = false;
      const results = [];
      for (const id of ids) {
        const report = await rehearse(id, controller.signal);
        const path = await store.save(report);
        results.push({ scenario: id, runId: report.id, report: path, verification: report.verification, confirmedFailures: report.confirmedFailures });
        failed ||= !report.verification.passed || (command === 'rehearse' && report.confirmedFailures.length > 0);
      }
      print(results);
      return failed ? 1 : 0;
    }
    case 'report':
    case 'task': {
      const report = await store.get(runId.parse(value));
      if (!report) throw new Error('Rehearsal report was not found.');
      print(command === 'report' ? report : exportTask(report));
      return 0;
    }
    default:
      throw new Error(usage);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unexpected operational error.');
  process.exitCode = 2;
} finally {
  if (interrupted) process.exitCode = interrupted;
}
