import { constants } from 'node:fs';
import { link, mkdir, open, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { reportSchema, reportSummary, runId } from './model.ts';
import type { RehearsalReport } from './model.ts';

const maxReportBytes = 1024 * 1024;
const historyLimit = 100;

export async function readTextFile(path: string, limit: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error('Choose a regular file within the size limit.');
    const content = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new Error('File exceeds the size limit.');
    return new TextDecoder('utf-8', { fatal: true }).decode(content.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

export function reports(root = process.env.MIGRATEPROOF_REPORT_DIR ?? 'runs') {
  const location = resolve(root);
  const pathFor = (id: string) => resolve(location, `${runId.parse(id)}.json`);

  async function get(id: string) {
    try {
      const report = reportSchema.parse(JSON.parse(await readTextFile(pathFor(id), maxReportBytes)));
      if (report.id !== id) throw new Error('Report identifier does not match its file.');
      return report;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  return {
    async save(report: RehearsalReport) {
      const validated = reportSchema.parse(report);
      const contents = `${JSON.stringify(validated, null, 2)}\n`;
      if (Buffer.byteLength(contents) > maxReportBytes) throw new Error('Report exceeds the size limit.');
      await mkdir(location, { recursive: true, mode: 0o700 });
      const target = pathFor(validated.id);
      const temp = resolve(location, `.${randomUUID()}.tmp`);
      await writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
      try {
        await link(temp, target);
      } finally {
        await unlink(temp);
      }
      return target;
    },
    get,
    async list() {
      const entries = await readdir(location, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      const history = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const id = runId.safeParse(entry.name.slice(0, -5));
        if (!id.success) continue;
        const report = await get(id.data);
        if (report) history.push(reportSummary.parse(report));
      }
      return history.sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id)).slice(0, historyLimit);
    },
  };
}
