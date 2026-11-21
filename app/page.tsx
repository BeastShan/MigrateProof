import Link from 'next/link';
import { inventory } from './backend';
import { formatTime, highestRisk } from './presentation';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const data = await inventory().catch(() => null);
  if (!data) return <section className="notice" role="alert">
    <h1>Evidence API unavailable</h1><p>Start the local Fastify API with <code>npm run api</code> and reload this page.</p>
  </section>;
  const { scenarios, runs } = data;
  const latestByScenario = new Map(scenarios.map(scenario => [scenario.id, runs.find(run => run.scenario.id === scenario.id)]));
  const verified = runs.filter(run => run.verification.passed).length;
  return <>
    <section className="hero">
      <div><p className="eyebrow">PostgreSQL migration safety lab</p><h1>Migration evidence</h1>
      <p className="intro">Reproduce migration failures, verify corrections, and review the evidence before a production change.</p></div>
      <a className="button" href="#history">View rehearsal history</a>
    </section>
    <div className="stats">
      <div><p>Migration scenarios</p><strong>{scenarios.length}</strong><span>Bundled synthetic fixtures</span></div>
      <div><p>Recent rehearsals</p><strong>{runs.length}</strong><span>Saved PostgreSQL reports</span></div>
      <div><p>Verified outcomes</p><strong>{verified}<small> / {runs.length}</small></strong><span>Matched fixture expectations</span></div>
      <div><p>Human review</p><strong className="review-value">Required</strong><span>Before merge or deployment</span></div>
    </div>
    <section id="inventory" aria-labelledby="inventory-heading" className="section">
      <div className="section-header"><div><h2 id="inventory-heading">Migration inventory</h2><p>Static SQL risks and the latest saved rehearsal for each scenario.</p></div></div>
      <div className="table-shell"><table>
        <thead><tr><th scope="col">Scenario</th><th scope="col">Static risk</th><th scope="col">Correction</th><th scope="col">Latest evidence</th></tr></thead>
        <tbody>{scenarios.map(scenario => {
          const latest = latestByScenario.get(scenario.id);
          const risk = highestRisk(scenario.analysis.risks);
          return <tr key={scenario.id}>
            <th scope="row"><span className="row-title">{scenario.title}</span><span className="row-subtitle">{scenario.description}</span></th>
            <td><span className={`badge ${risk}`}>{risk}</span></td>
            <td>{scenario.correctionAvailable ? 'Included' : 'Recovery review'}</td>
            <td>{latest ? <Link className="text-link" href={`/rehearsals/${latest.id}`}>View evidence<span className="sr-only"> for {scenario.title}</span></Link> : <span className="muted">Awaiting rehearsal</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
    <section id="history" aria-labelledby="history-heading" className="section">
      <div className="section-header"><div><h2 id="history-heading">Rehearsal history</h2><p>Latest saved runs, including intentional failures and their verification results.</p></div></div>
      {runs.length ? <div className="table-shell"><table>
        <thead><tr><th scope="col">Scenario</th><th scope="col">Run completed</th><th scope="col">Fixture verification</th><th scope="col">Observed failures</th><th scope="col">Engineering task</th></tr></thead>
        <tbody>{runs.map(run => <tr key={run.id}>
          <th scope="row"><Link className="text-link" href={`/rehearsals/${run.id}`}>{run.scenario.title}</Link><span className="row-subtitle mono">{run.id.slice(0, 8)}</span></th>
          <td><time dateTime={run.completedAt}>{formatTime(run.completedAt)}</time></td>
          <td><span className={`badge ${run.verification.passed ? 'pass' : 'critical'}`}>{run.verification.passed ? 'Verified' : 'Unexpected result'}</span></td>
          <td className="mono">{run.confirmedFailures.length}</td>
          <td><a className="text-link" href={`/rehearsals/${run.id}/task`}>Export task<span className="sr-only"> for {run.scenario.title}</span></a></td>
        </tr>)}</tbody>
      </table></div> : <div className="notice"><h3>No saved rehearsals</h3><p>Run <code>npm run lab -- verify</code> to generate evidence for all six scenarios.</p></div>}
    </section>
  </>;
}
