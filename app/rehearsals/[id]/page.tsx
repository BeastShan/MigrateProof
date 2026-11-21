import Link from 'next/link';
import { notFound } from 'next/navigation';
import { rehearsal } from '../../backend';
import { formatTime } from '../../presentation';
import { runId } from '../../../src/model.ts';
import type { Attempt, Check, Snapshot } from '../../../src/model.ts';

export const dynamic = 'force-dynamic';

function Checks({ title, checks }: { title: string; checks: Check[] }) {
  return <div className="checks"><h4>{title}</h4>{checks.length ? checks.map(check => <details key={check.name}>
    <summary><span>{check.name}</span><span className={`badge ${check.passed ? 'pass' : 'critical'}`}>{check.passed ? 'Pass' : 'Failed'}</span></summary>
    <pre>{check.execution.sql}</pre>
    {check.expectedSqlState && <p>Expected rejection · SQLSTATE {check.expectedSqlState}</p>}
    <p>{check.execution.sqlState ? `SQLSTATE ${check.execution.sqlState} · ${check.execution.detail}` : `${check.rows.length} result rows`}</p>
    {check.rows.length > 0 && <pre>{JSON.stringify(check.rows, null, 2)}</pre>}
  </details>) : <p className="muted">No checks configured.</p>}</div>;
}

function SnapshotCard({ label, snapshot }: { label: string; snapshot: Snapshot }) {
  return <div className="snapshot">
    <h3>{label}</h3>
    {snapshot.plan && <div className="plan">
      <p className="eyebrow">EXPLAIN ANALYZE</p><strong>{snapshot.plan.rootNode}</strong>
      <p>{snapshot.plan.sharedBlocks.toLocaleString('en-US')} shared blocks accessed <span>·</span> {snapshot.plan.executionMs.toFixed(3)} ms</p>
      <details><summary>Query plan JSON</summary><pre>{JSON.stringify(snapshot.plan.evidence, null, 2)}</pre></details>
    </div>}
    <Checks title="Compatibility checks" checks={snapshot.compatibility} />
    <Checks title="Integrity checks" checks={snapshot.integrity} />
    <details className="catalog"><summary>Schema catalog</summary><pre>{JSON.stringify(snapshot.schema, null, 2)}</pre></details>
  </div>;
}

function AttemptCard({ title, attempt }: { title: string; attempt: Attempt }) {
  const { migration } = attempt;
  return <section className="section" aria-label={title}>
    <div className="section-header"><div><h2>{title}</h2><p>{migration.label}</p></div>
      <span className={`badge ${migration.status === 'ok' ? 'neutral' : 'critical'}`}>{attempt.disposition === 'committed' ? 'DDL committed' : 'Transaction rolled back'}</span>
    </div>
    <div className="sql-card"><pre>{migration.sql.trim()}</pre>
      <p>{migration.sqlState ? `SQLSTATE ${migration.sqlState} · ${migration.detail}` : migration.commands.map(command => command.command).join(', ')} <span>·</span> {migration.elapsedMs.toFixed(1)} ms wall time</p></div>
    <div className="snapshots"><SnapshotCard label="Baseline" snapshot={attempt.baseline} /><SnapshotCard label="After execution" snapshot={attempt.after} /></div>
    <div className="diagnostics"><Checks title="Execution and transaction diagnostics" checks={attempt.diagnostics} /></div>
  </section>;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = runId.safeParse((await params).id);
  if (!parsed.success) notFound();
  const result = await rehearsal(parsed.data).then(report => ({ report }), () => null);
  if (!result) return <section className="notice" role="alert"><h1>Evidence API unavailable</h1><p>Check the local API and reload this page.</p></section>;
  const { report } = result;
  if (!report) notFound();
  return <>
    <Link href="/#history" className="back text-link">Rehearsal history</Link>
    <section className="hero detail-hero"><div>
      <p className="eyebrow">Rehearsal report · {report.id.slice(0, 8)}</p><h1>{report.scenario.title}</h1>
      <p className="intro">PostgreSQL {report.postgresVersion} · {formatTime(report.completedAt)} · Synthetic fixture</p>
    </div><div className="actions"><a className="button secondary" href={`/rehearsals/${report.id}/report`}>Download report</a><a className="button" href={`/rehearsals/${report.id}/task`}>Export engineering task</a></div></section>
    <div className="review-grid">
      <div className="notice verification"><span className={`badge ${report.verification.passed ? 'pass' : 'critical'}`}>{report.verification.passed ? 'Fixture verification passed' : 'Fixture verification failed'}</span><p>{report.verification.expectation}</p></div>
      <div className="notice review"><span className="badge medium">Human review required</span><p>{report.review.reason}</p></div>
    </div>
    <section className="section" aria-label="Confirmed failures">
      <div className="section-header"><div><h2>Confirmed failures</h2><p>Observed against the proposed migration in the disposable lab.</p></div></div>
      <div className="notice">{report.confirmedFailures.length ? <ul className="evidence-list">{report.confirmedFailures.map(({ code, sqlState, evidence }, index) =>
        <li key={index}><code>{code}{sqlState && ` · ${sqlState}`}</code><span>{evidence}</span></li>)}</ul> : <p>None observed in this rehearsal.</p>}</div>
    </section>
    <AttemptCard title="Proposed migration" attempt={report.proposed} />
    {report.correction && <AttemptCard title="Correction rehearsal" attempt={report.correction} />}
    <section className="section" aria-label="Static analysis and follow-up">
      <div className="section-header"><div><h2>Static analysis and follow-up</h2></div></div>
      <div className="notice"><ul className="evidence-list">{report.scenario.analysis.risks.map(risk => <li key={`${risk.statement}-${risk.code}`}>
        <span className={`badge ${risk.severity}`}>{risk.severity}</span><div><strong>{risk.code}</strong><p>{risk.category.replaceAll('-', ' ')} · statement {risk.statement}</p><p>{risk.explanation}</p></div>
      </li>)}</ul>
      <h3>Unverified assumptions</h3><ul>{report.scenario.analysis.unverifiedAssumptions.map(line => <li key={line}>{line}</li>)}</ul>
      <h3>Proposed engineering tasks</h3><ul>{report.followUp.map(line => <li key={line}>{line}</li>)}</ul></div>
    </section>
  </>;
}
