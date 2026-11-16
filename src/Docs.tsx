import { Shell } from './Shell.tsx'
import { BackToHome, go } from './router.tsx'
import { DOCS, LIMITS, PRICE_TIERS } from './analyze.ts'

const ext = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer">{text}</a>

export default function Docs() {
  return (
    <Shell name="History Doctor" tagline="Temporal workflow history analyzer">
      <BackToHome />
      <section className="panel" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
        <h1>How History Doctor works</h1>
        <p>
          History Doctor parses a Temporal Event History export in your browser and estimates limits, payload bloat, retries and
          Temporal Cloud Actions. Nothing is uploaded. <a href="/app" onClick={e => { e.preventDefault(); go('/app') }}>Open the analyzer</a>.
        </p>

        <h2>Supported input</h2>
        <ul>
          <li><code>temporal workflow show -w &lt;id&gt; --output json</code> (proto enum event types, <code>{'{"events": [...]}'}</code>).</li>
          <li><code>--output jsonl</code> (one event per line), Web UI downloads, and <code>{'{"history": {"events": [...]}}'}</code> wrappers.</li>
          <li>Older PascalCase event types (<code>WorkflowExecutionStarted</code>) as written by older CLIs and the Java SDK test suite.</li>
        </ul>

        <h2>Reference data (checked 2026-11-16)</h2>
        <h3>Limits</h3>
        <p>
          From {ext(DOCS.limits, 'docs.temporal.io/cloud/limits')}: Event History warns at {LIMITS.eventsWarn.toLocaleString()} events
          or 10 MB and is terminated at {LIMITS.eventsMax.toLocaleString()} events or 50 MB; 2 MB per payload, 4 MB per gRPC message and
          per history transaction; {LIMITS.signalsMax.toLocaleString()} Signals per execution.
        </p>
        <h3>Actions</h3>
        <p>
          Counted per {ext(DOCS.actions, 'docs.temporal.io/cloud/actions')}: Workflow start (Child starts are 2 Actions on the parent,
          Signal-With-Start is 1 in total, Schedule executions are 3), every Activity attempt (from <code>ActivityTaskStarted.attempt</code>),
          Timers, Signals, accepted Updates, Search Attribute upserts (excluding <code>TemporalChangeVersion</code>), one Action per Workflow
          Task that records markers, Local Activity retries from <code>meteringMetadata.nonfirstLocalActivityExecutionAttempts</code>,
          Workflow resets (<code>WorkflowTaskFailed</code> with cause <code>RESET_WORKFLOW</code>), Nexus schedule and cancel, and
          Workflow options updates. Heartbeats, Queries and rejected Updates are not in history; heartbeats are an optional upper-bound
          estimate. Temporal says its own metrics can differ by up to 5% from metering; your invoice is authoritative.
        </p>
        <h3>Pricing</h3>
        <p>
          From {ext(DOCS.pricing, 'docs.temporal.io/cloud/pricing')}: $50 per million Actions on the Developer plan. Business,
          Enterprise and Mission Critical use graduated monthly tiers, which the "Monthly with volume tiers" figure applies:
        </p>
        <div className="table-wrap"><table>
          <thead><tr><th>Monthly volume</th><th className="num">USD per million</th></tr></thead>
          <tbody>{PRICE_TIERS.map(([upTo, rate], i) => (
            <tr key={upTo}><td>{i ? `${PRICE_TIERS[i - 1][0]}M to ${upTo}M` : `First ${upTo}M`}</td><td className="num">${rate}</td></tr>
          ))}<tr><td>Over 200M</td><td className="num">contract (last tier used)</td></tr></tbody>
        </table></div>
        <p className="muted">Plan allowances, support fees and storage are not included.</p>

        <h2>Samples</h2>
        <p>
          The three named scenarios (order fulfillment, subscription entity, payment retry storm) are synthetic histories generated in
          the browser in the exact export shape. The two "Real" samples are unmodified histories from the Temporal SDK replay test suites:
        </p>
        <ul>
          <li>{ext('https://github.com/temporalio/sdk-typescript/tree/main/packages/test/history_files', 'temporalio/sdk-typescript')} <code>random-replay-1.17.2.json</code>, MIT licence.</li>
          <li>{ext('https://github.com/temporalio/sdk-python/tree/main/tests/worker', 'temporalio/sdk-python')} <code>test_replayer_event_tracing_double_sig_at_start.json</code>, MIT licence.</li>
        </ul>
        <p className="muted">
          The test suite also runs against histories from {ext('https://github.com/temporalio/sdk-java/tree/master/temporal-sdk/src/test/resources', 'temporalio/sdk-java')} (Apache-2.0) and further sdk-python files.
        </p>

        <h2>Known limitations</h2>
        <ul>
          <li>Without <code>historySizeBytes</code> in the export, history size is the JSON size, which overstates the protobuf size.</li>
          <li>Growth projection is linear over the observed run.</li>
          <li>Payloads encrypted or compressed by a codec are measured as stored, not decoded.</li>
        </ul>
      </section>
    </Shell>
  )
}
