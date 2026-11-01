import { useDeferredValue, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { Shell } from './Shell.tsx'
import { BackToHome } from './router.tsx'
import { analyze, CATEGORIES, DOCS, fmtBytes, LIMITS, parseHistory, project, type Analysis } from './analyze.ts'
import { SAMPLES } from './samples.ts'

const LIST_PRICE = 50 // USD per million Actions, Temporal Cloud pay-as-you-go list price
const TABS = ['Recommendations', 'Actions & cost', 'Payloads', 'Limits', 'Retries & failures', 'Timeline'] as const
type Tab = (typeof TABS)[number]
type Source = { id: number; name: string; text: string }
type Result = { name: string; a?: Analysis; error?: string }

const num = (n: number) => Math.round(n).toLocaleString()
const pct = (n: number) => `${n < 0.1 && n > 0 ? '<0.1' : n.toFixed(n < 10 ? 1 : 0)}%`
const money = (n: number) => n === 0 ? '$0' : n < 1
  ? '$' + n.toPrecision(2)
  : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 })
function dur(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
  return `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`
}
const level = (v: number, warn: number, max: number) => (v >= max * 0.9 ? 'bad' : v >= warn ? 'warn' : 'good')
const statusBadge = (s: string) => s === 'Completed' ? 'good' : s === 'Running' || s === 'Continued-As-New' ? 'info' : 'bad'
const sevLabel = { bad: 'High', warn: 'Medium', info: 'Low' }
let nextId = 1

export default function Tool() {
  // ?sample=entity,retry preloads samples, handy for sharing a demo link.
  const [sources, setSources] = useState<Source[]>(() => {
    const ids = new URLSearchParams(location.search).get('sample')?.split(',') ?? []
    return SAMPLES.filter(s => ids.includes(s.id)).map(s => ({ id: nextId++, name: s.file, text: s.make() }))
  })
  const [paste, setPaste] = useState('')
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState<Tab>('Recommendations')
  const [price, setPrice] = useState(LIST_PRICE)
  const [perDay, setPerDay] = useState(1000)
  const [withHeartbeats, setWithHeartbeats] = useState(false)
  const [over, setOver] = useState(false)
  const deferredPaste = useDeferredValue(paste)

  const results = useMemo<Result[]>(() => {
    const all = deferredPaste.trim() ? [{ id: 0, name: 'Pasted JSON', text: deferredPaste }, ...sources] : sources
    return all.map(s => {
      try { return { name: s.name, a: analyze(parseHistory(s.text), s.name) } } catch (e) { return { name: s.name, error: (e as Error).message } }
    })
  }, [deferredPaste, sources])
  const ok = results.filter(r => r.a).map(r => r.a!)
  const a = ok.find(x => x.name === selected) ?? ok[0]

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const added = await Promise.all([...files].map(async f => ({ id: nextId++, name: f.name, text: await f.text() })))
    setSources(s => {
      const out = [...s]
      for (const f of added) {
        let name = f.name
        for (let i = 2; out.some(x => x.name === name); i++) name = `${f.name} (${i})`
        out.push({ ...f, name })
      }
      return out
    })
    setSelected(added[0].name)
  }
  const loadSample = (i: number) => {
    const s = SAMPLES[i]
    setSources(prev => [...prev.filter(p => p.name !== s.file), { id: nextId++, name: s.file, text: s.make() }])
    setSelected(s.file)
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }
  const actionsOf = (x: Analysis) => x.totalActions + (withHeartbeats ? x.heartbeatEstimate : 0)

  return (
    <Shell name="History Doctor" tagline="Temporal workflow history analyzer" icon="monitoring">
      <BackToHome />
      <section className="hero">
        <h1>Diagnose a Temporal workflow history</h1>
        <p>
          Drop in an exported Event History to see how close it is to Temporal's size and event limits, which payloads are bloating it,
          where retries are burning Actions, and what it costs on Temporal Cloud.
        </p>
        <div className="privacy"><span className="badge good">Private</span>Runs entirely in your browser — histories never leave your machine.</div>
      </section>

      <section className="panel" onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <div className="grid cols-2">
          <label style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 14 }}>Paste history JSON</strong>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} spellCheck={false}
              placeholder={'{\n  "events": [\n    { "eventId": "1", "eventType": "EVENT_TYPE_WORKFLOW_EXECUTION_STARTED", ... }\n  ]\n}'} />
          </label>
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <label className={`drop ${over ? 'over' : ''}`}>
              <input type="file" accept=".json,.jsonl,application/json" multiple onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
              <strong>Drop history files here, or click to choose</strong>
              <span className="muted" style={{ fontSize: 13 }}>Several files are compared side by side</span>
            </label>
            <div>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Export a history with the Temporal CLI</div>
              <pre className="cmd mono">temporal workflow show -w &lt;workflow-id&gt; --output json &gt; h.json</pre>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Or load a sample</div>
              <div className="row">
                {SAMPLES.map((s, i) => <button key={s.id} className="btn ghost" onClick={() => loadSample(i)}>{s.label}</button>)}
              </div>
            </div>
          </div>
        </div>
        {(sources.length > 0 || results.some(r => r.error)) && (
          <div style={{ marginTop: 14 }}>
            <div className="row">
              {sources.map(s => {
                const err = results.find(r => r.name === s.name)?.error
                return (
                  <span key={s.id} className={`chip ${err ? 'err' : ''}`} title={s.name}>
                    <span>{s.name}</span>
                    <button aria-label={`Remove ${s.name}`} onClick={() => setSources(x => x.filter(y => y.id !== s.id))}>×</button>
                  </span>
                )
              })}
              {sources.length > 1 && <button className="btn ghost" onClick={() => setSources([])}>Clear all</button>}
            </div>
            {results.filter(r => r.error).map(r => (
              <div key={r.name} className="finding bad"><strong>{r.name}:</strong> {r.error}</div>
            ))}
          </div>
        )}
      </section>

      {ok.length > 1 && <Compare list={ok} current={a} onSelect={x => setSelected(x.name)} price={price} perDay={perDay} actionsOf={actionsOf} />}

      {a ? (
        <>
          <Overview a={a} price={price} actions={actionsOf(a)} />
          <section className="panel">
            <div className="tabs" role="tablist">
              {TABS.map(t => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {t}{t === 'Recommendations' && <span className={`badge ${a.recs[0].severity === 'info' ? 'info' : a.recs[0].severity}`}>{a.recs.filter(r => r.title !== 'No issues found').length}</span>}
                </button>
              ))}
            </div>
            {tab === 'Recommendations' && <Recs a={a} />}
            {tab === 'Actions & cost' && (
              <Cost a={a} price={price} setPrice={setPrice} perDay={perDay} setPerDay={setPerDay} withHeartbeats={withHeartbeats} setWithHeartbeats={setWithHeartbeats} />
            )}
            {tab === 'Payloads' && <Payloads a={a} />}
            {tab === 'Limits' && <Limits a={a} />}
            {tab === 'Retries & failures' && <Retries a={a} />}
            {tab === 'Timeline' && <Timeline a={a} />}
          </section>
        </>
      ) : !results.length && (
        <section className="panel muted" style={{ textAlign: 'center', padding: 32 }}>
          Paste a history, drop a file, or load a sample to get started.
        </section>
      )}
    </Shell>
  )
}

function Compare({ list, current, onSelect, price, perDay, actionsOf }: {
  list: Analysis[]; current: Analysis; onSelect: (a: Analysis) => void; price: number; perDay: number; actionsOf: (a: Analysis) => number
}) {
  const sum = (f: (a: Analysis) => number) => list.reduce((n, a) => n + f(a), 0)
  const monthly = (a: Analysis) => (actionsOf(a) / 1e6) * price * perDay * 30
  return (
    <section className="panel">
      <div className="head-row">
        <h2>Comparing {list.length} histories</h2>
        <span className="muted" style={{ fontSize: 13 }}>Click a row to inspect it. Monthly cost assumes {num(perDay)} runs/day each at ${price}/M Actions.</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>File</th><th>Workflow type</th><th>Status</th><th className="num">Events</th><th className="num">History size</th>
            <th className="num">Largest payload</th><th className="num">Retries</th><th className="num">Actions</th><th className="num">$/month</th><th>Top finding</th>
          </tr></thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={i} className={`clickable ${a === current ? 'selected' : ''}`} onClick={() => onSelect(a)}>
                <td className="ellipsis" title={a.name}>{a.name}</td>
                <td>{a.workflowType}</td>
                <td><span className={`badge ${statusBadge(a.status)}`}>{a.status}</span></td>
                <td className="num">{num(a.eventCount)}</td>
                <td className="num">{fmtBytes(a.historyBytes)}</td>
                <td className="num">{a.payloads[0] ? fmtBytes(a.payloads[0].bytes) : '—'}</td>
                <td className="num">{num(a.activities.reduce((n, s) => n + s.retries, 0))}</td>
                <td className="num">{num(actionsOf(a))}</td>
                <td className="num">{money(monthly(a))}</td>
                <td><span className={`badge ${a.recs[0].severity}`}>{a.recs[0].title}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={3}>Total</td>
            <td className="num">{num(sum(a => a.eventCount))}</td>
            <td className="num">{fmtBytes(sum(a => a.historyBytes))}</td>
            <td />
            <td className="num">{num(sum(a => a.activities.reduce((n, s) => n + s.retries, 0)))}</td>
            <td className="num">{num(sum(actionsOf))}</td>
            <td className="num">{money(sum(monthly))}</td>
            <td />
          </tr></tfoot>
        </table>
      </div>
    </section>
  )
}

function LimitBar({ value, warn, max, fmt }: { value: number; warn: number; max: number; fmt: (n: number) => string }) {
  return (
    <div className="limit" aria-label={`${fmt(value)} of ${fmt(max)} limit`}>
      <div className="bar"><span className={level(value, warn, max)} style={{ width: `${Math.min(100, Math.max(1, (value / max) * 100))}%` }} /></div>
      <span className="tick" style={{ left: `${(warn / max) * 100}%` }} title={`Warning at ${fmt(warn)}`} />
      <div className="scale"><span>warn {fmt(warn)}</span><span>limit {fmt(max)}</span></div>
    </div>
  )
}

function Stat({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return <div className="stat"><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}{children}</div>
}

function Overview({ a, price, actions }: { a: Analysis; price: number; actions: number }) {
  const largest = a.payloads[0]
  return (
    <section>
      <div className="head-row">
        <h2 style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {a.workflowType} <span className={`badge ${statusBadge(a.status)}`}>{a.status}</span>
        </h2>
        <span className="muted mono" style={{ fontSize: 12.5 }}>{[a.workflowId, a.taskQueue && `queue: ${a.taskQueue}`, a.name].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="stats">
        <Stat label={a.status === 'Running' ? 'Running for (observed)' : 'Run duration'} value={dur(a.durationMs)} sub={`${new Date(a.start).toLocaleString()}`} />
        <Stat label="Events" value={num(a.eventCount)} sub={`${pct((a.eventCount / LIMITS.eventsMax) * 100)} of hard limit`}>
          <LimitBar value={a.eventCount} warn={LIMITS.eventsWarn} max={LIMITS.eventsMax} fmt={n => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n))} />
        </Stat>
        <Stat label={a.historyBytesReported ? 'History size (server-reported)' : 'History size (JSON upper bound)'} value={fmtBytes(a.historyBytes)}
          sub={a.historyBytesReported ? `historySizeBytes as of event ${num(a.historyBytesAtEvent)}` : 'export JSON size; real proto size is smaller'}>
          <LimitBar value={a.historyBytes} warn={LIMITS.bytesWarn} max={LIMITS.bytesMax} fmt={n => `${Math.round(n / 1024 / 1024)} MB`} />
        </Stat>
        <Stat label="Payload bytes (decoded)" value={fmtBytes(a.payloadBytes)} sub={`${num(a.payloadCount)} payloads · largest ${largest ? fmtBytes(largest.bytes) : '—'}`}>
          {largest && <LimitBar value={largest.bytes} warn={LIMITS.payloadMax / 2} max={LIMITS.payloadMax} fmt={n => `${(n / 1024 / 1024).toFixed(0)} MB`} />}
        </Stat>
        <Stat label="Billable Actions (est.)" value={num(actions)} sub={a.heartbeatEstimate ? `+ up to ${num(a.heartbeatEstimate)} heartbeats not in history` : 'from events in history'} />
        <Stat label="Cost of this run" value={money((actions / 1e6) * price)} sub={`at $${price} per million Actions`} />
      </div>
    </section>
  )
}

function Recs({ a }: { a: Analysis }) {
  return (
    <div>
      {a.recs.map((r, i) => (
        <div key={i} className={`finding ${r.severity === 'info' ? 'good' : r.severity}`}>
          <div className="head"><span className={`badge ${r.severity === 'info' ? 'info' : r.severity}`}>{sevLabel[r.severity]}</span>{r.title}</div>
          <p>{r.detail}</p>
          <a href={r.doc} target="_blank" rel="noreferrer">Temporal docs: {r.docLabel} ↗</a>
        </div>
      ))}
    </div>
  )
}

function Cost({ a, price, setPrice, perDay, setPerDay, withHeartbeats, setWithHeartbeats }: {
  a: Analysis; price: number; setPrice: (n: number) => void; perDay: number; setPerDay: (n: number) => void
  withHeartbeats: boolean; setWithHeartbeats: (b: boolean) => void
}) {
  const total = a.totalActions + (withHeartbeats ? a.heartbeatEstimate : 0)
  const rows = [...a.actions, ...(withHeartbeats && a.heartbeatEstimate ? [{ kind: 'Activity heartbeats (estimated)', count: a.heartbeatEstimate, note: 'Upper bound: every throttle window (min(80% of heartbeat timeout, 60s)) of the final attempt.' }] : [])]
    .sort((x, y) => y.count - x.count)
  const perRun = (total / 1e6) * price
  const actByType = a.activities.map(s => ({ type: s.type, n: s.attempts + (withHeartbeats ? s.heartbeatEstimate : 0), s })).filter(x => x.n).sort((x, y) => y.n - x.n)
  return (
    <div>
      <div className="controls">
        <label>Price per million Actions (USD)
          <input type="number" min={0} step={1} value={price} onChange={e => setPrice(Math.max(0, +e.target.value))} />
          <span>Default ${LIST_PRICE}: Temporal Cloud pay-as-you-go list price (<a href="https://temporal.io/pricing" target="_blank" rel="noreferrer">pricing</a>); volume tiers go lower.</span>
        </label>
        <label>Executions per day like this one
          <input type="number" min={0} step={100} value={perDay} onChange={e => setPerDay(Math.max(0, +e.target.value))} />
          <span>At {num(perDay)}/day: <strong style={{ color: 'var(--text)' }}>{money(perRun * perDay * 30)}/month</strong> ({num(total * perDay * 30)} Actions)</span>
        </label>
      </div>
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Actions per run" value={num(total)} />
        <Stat label="Cost per run" value={money(perRun)} />
        <Stat label="Cost per 1,000 runs" value={money(perRun * 1000)} />
        <Stat label={`Monthly at ${num(perDay)}/day`} value={money(perRun * perDay * 30)} sub="30-day month, Actions only" />
      </div>
      <div className="grid cols-2">
        <div>
          <h3>By action kind</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Action</th><th className="num">Count</th><th>Share</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.kind}>
                <td>{r.kind}{r.note && <div className="muted" style={{ fontSize: 12.5 }}>{r.note}</div>}</td>
                <td className="num">{num(r.count)}</td>
                <td className="num"><span className="minibar"><span style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} /></span>{pct(total ? (r.count / total) * 100 : 0)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
        <div>
          <h3>Activity Actions by type</h3>
          {actByType.length ? <div className="table-wrap"><table>
            <thead><tr><th>Activity type</th><th className="num">Runs</th><th className="num">Actions</th><th className="num">Cost/run</th></tr></thead>
            <tbody>{actByType.map(x => (
              <tr key={x.type}>
                <td>{x.type}{x.s.retries > 0 && <> <span className="badge warn">{num(x.s.retries)} retries</span></>}</td>
                <td className="num">{num(x.s.scheduled)}</td>
                <td className="num">{num(x.n)}</td>
                <td className="num">{money((x.n / 1e6) * price)}</td>
              </tr>
            ))}</tbody>
          </table></div> : <p className="muted">No activities in this history.</p>}
          <h3 style={{ marginTop: 18 }}>Billed but not visible in history</h3>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
            <li>
              Activity heartbeats{a.heartbeatEstimate ? ` (up to ~${num(a.heartbeatEstimate)} here)` : ''}.{' '}
              <label className="check"><input type="checkbox" checked={withHeartbeats} onChange={e => setWithHeartbeats(e.target.checked)} />include estimate</label>
            </li>
            <li>Queries, rejected Updates, Workflow Task heartbeats of long Local Activities.</li>
            <li>Schedule create/update/delete, Workflow exports, and Temporal Cloud storage (billed separately per GB-hour).</li>
          </ul>
          <p className="muted" style={{ fontSize: 13 }}>
            Counted per <a href={DOCS.actions} target="_blank" rel="noreferrer">Temporal Cloud: What is an Action?</a> Actions in this history are an estimate; your invoice is authoritative.
          </p>
        </div>
      </div>
    </div>
  )
}

function Payloads({ a }: { a: Analysis }) {
  if (!a.payloads.length) return <p className="muted">No payloads found in this history.</p>
  const top = a.payloadSources.slice(0, 10)
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Sizes are decoded payload bytes (data + metadata). Temporal Cloud rejects any single payload over 2 MB and any request over 4 MB (
        <a href={DOCS.limits} target="_blank" rel="noreferrer">limits</a>, <a href={DOCS.blobSize} target="_blank" rel="noreferrer">BlobSizeLimitError</a>).
      </p>
      <div className="grid cols-2">
        <div>
          <h3>Largest payloads</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Source</th><th className="num">Size</th><th>vs 2 MB</th><th className="num">Event</th></tr></thead>
            <tbody>{a.payloads.slice(0, 15).map((p, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td>{p.source}<div className="muted" style={{ fontSize: 12.5 }}>{p.field} · {p.encoding}</div></td>
                <td className="num">{fmtBytes(p.bytes)}</td>
                <td className="num"><span className="minibar"><span className={level(p.bytes, LIMITS.payloadMax / 4, LIMITS.payloadMax)} style={{ width: `${Math.max(1, (p.bytes / LIMITS.payloadMax) * 100)}%` }} /></span>{pct((p.bytes / LIMITS.payloadMax) * 100)}</td>
                <td className="num">{p.eventId}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
        <div>
          <h3>Where the bytes come from</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Source</th><th className="num">Count</th><th className="num">Total</th><th className="num">Max</th></tr></thead>
            <tbody>{top.map(g => (
              <tr key={g.source + g.field}>
                <td>{g.source}<div className="muted" style={{ fontSize: 12.5 }}>{g.field}</div></td>
                <td className="num">{num(g.count)}</td>
                <td className="num">{fmtBytes(g.bytes)}</td>
                <td className="num">{fmtBytes(g.max)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {a.signals.length > 0 && <>
            <h3 style={{ marginTop: 18 }}>Signals</h3>
            <div className="table-wrap"><table>
              <thead><tr><th>Signal</th><th className="num">Count</th><th className="num">Payload bytes</th></tr></thead>
              <tbody>{a.signals.map(s => <tr key={s.name}><td>{s.name}</td><td className="num">{num(s.count)}</td><td className="num">{fmtBytes(s.bytes)}</td></tr>)}</tbody>
            </table></div>
          </>}
        </div>
      </div>
    </div>
  )
}

function eta(days: number | null) {
  if (days === null) return <span className="muted">not growing</span>
  if (days === 0) return <span className="badge bad">reached</span>
  const label = days < 1 ? `~${Math.max(1, Math.round(days * 24))} hours` : days > 3650 ? '> 10 years' : `~${num(days)} days`
  return <><span className={`badge ${days < 30 ? 'bad' : days < 180 ? 'warn' : 'good'}`}>{label}</span>{days <= 3650 && <span className="muted"> · {new Date(Date.now() + days * 86_400_000).toLocaleDateString()}</span>}</>
}

function Limits({ a }: { a: Analysis }) {
  const p = project(a)
  const sigs = a.signals.reduce((n, s) => n + s.count, 0)
  const rows: [string, string, string, ReactNode][] = p ? [
    ['Events: warning', num(a.eventCount), num(LIMITS.eventsWarn), eta(p.daysTo.eventsWarn)],
    ['Events: hard limit', num(a.eventCount), num(LIMITS.eventsMax), eta(p.daysTo.eventsMax)],
    ['History size: warning', fmtBytes(a.historyBytes), '10 MB', eta(p.daysTo.bytesWarn)],
    ['History size: hard limit', fmtBytes(a.historyBytes), '50 MB', eta(p.daysTo.bytesMax)],
  ] : []
  return (
    <div>
      {p ? <>
        <p className="muted" style={{ marginTop: 0 }}>
          Linear extrapolation over the observed {dur(a.durationMs)}: <strong style={{ color: 'var(--text)' }}>{num(p.eventsPerDay)} events/day</strong> and{' '}
          <strong style={{ color: 'var(--text)' }}>{fmtBytes(p.bytesPerDay)}/day</strong>.{' '}
          {a.status === 'Running' ? 'Times are from now.' : 'This run has closed; times show when a run with this growth rate would get there if it kept going.'}
        </p>
        <div className="table-wrap"><table>
          <thead><tr><th>Threshold</th><th className="num">Now</th><th className="num">Threshold</th><th>Time to reach</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r[0]}><td>{r[0]}</td><td className="num">{r[1]}</td><td className="num">{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
        </table></div>
      </> : <p className="muted">The run spans too little wall-clock time to extrapolate growth.</p>}
      <h3 style={{ marginTop: 18 }}>Other per-execution limits</h3>
      <div className="table-wrap"><table>
        <thead><tr><th>Limit</th><th className="num">This run</th><th className="num">Limit</th></tr></thead>
        <tbody>
          <tr><td>Largest single payload</td><td className="num">{a.payloads[0] ? fmtBytes(a.payloads[0].bytes) : '—'}</td><td className="num">2 MB</td></tr>
          <tr><td>Signals received</td><td className="num">{num(sigs)}</td><td className="num">10,000</td></tr>
          <tr><td>Server suggested Continue-As-New</td><td className="num">{a.suggestContinueAsNew ? <span className="badge warn">yes</span> : 'no'}</td><td className="num">—</td></tr>
        </tbody>
      </table></div>
      <p className="muted" style={{ fontSize: 13 }}>
        Thresholds from <a href={DOCS.limits} target="_blank" rel="noreferrer">Temporal Cloud limits</a> (self-hosted defaults are the same). When a history reaches the hard limit the
        execution is terminated; <a href={DOCS.can} target="_blank" rel="noreferrer">Continue-As-New</a> starts a fresh history.{' '}
        {!a.historyBytesReported && 'No historySizeBytes was found in this export, so the JSON size is used; it overstates the real (protobuf) size.'}
      </p>
    </div>
  )
}

function Retries({ a }: { a: Analysis }) {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Temporal writes only the final attempt of each activity to history; retries are derived from its attempt number. Attempts of activities still in flight are not visible until they finish.
      </p>
      {a.activities.length ? <div className="table-wrap"><table>
        <thead><tr>
          <th>Activity type</th><th className="num">Runs</th><th className="num">Attempts</th><th className="num">Retries</th><th className="num">Max attempt</th>
          <th className="num">Failed</th><th className="num">Timed out</th><th className="num">Pending</th><th className="num">Median duration</th><th>Last failure</th>
        </tr></thead>
        <tbody>{a.activities.map(s => (
          <tr key={s.type}>
            <td>{s.type}{s.retries >= 5 && <> <span className={`badge ${s.retries >= 20 ? 'bad' : 'warn'}`}>retry storm</span></>}</td>
            <td className="num">{num(s.scheduled)}</td>
            <td className="num">{num(s.attempts)}</td>
            <td className="num">{num(s.retries)}</td>
            <td className="num">{s.maxAttempt}</td>
            <td className="num">{s.failed || ''}</td>
            <td className="num" title={s.timeoutTypes.join(', ')}>{s.timedOut ? `${s.timedOut} (${s.timeoutTypes.join(', ')})` : ''}</td>
            <td className="num">{s.pending || ''}</td>
            <td className="num">{s.medianMs === null ? '—' : dur(s.medianMs)}</td>
            <td className="ellipsis" title={s.lastFailure}>{s.lastFailure || <span className="muted">—</span>}</td>
          </tr>
        ))}</tbody>
      </table></div> : <p className="muted">No activities in this history.</p>}
      <h3 style={{ marginTop: 18 }}>Workflow Task failures</h3>
      {a.workflowTaskFailures.length
        ? a.workflowTaskFailures.map(f => <div key={f.cause} className="finding bad"><strong className="mono">{f.cause}</strong> × {f.count}</div>)
        : <p className="muted">None.</p>}
    </div>
  )
}

const CAT_COLOR = Object.fromEntries(CATEGORIES.map((c, i) => [c, `var(--c${i + 1})`]))

function Timeline({ a }: { a: Analysis }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 1000, L = 120, R = 12, BINS = 160, LINE_H = 110, ROW = 18, GAP = 4
  const span = Math.max(1, a.end - a.start)
  const pw = W - L - R
  const bin = (t: number) => Math.min(BINS - 1, Math.floor(((t - a.start) / span) * BINS))
  const grid = CATEGORIES.map(() => new Array<number>(BINS).fill(0))
  const fails = new Array<number>(BINS).fill(0)
  const cum = new Array<number>(BINS).fill(0)
  for (const e of a.timeline) {
    const b = bin(e.time)
    grid[CATEGORIES.indexOf(e.cat)][b]++
    cum[b]++
    if (e.failed) fails[b]++
  }
  for (let i = 1; i < BINS; i++) cum[i] += cum[i - 1]
  const maxBin = Math.max(1, ...grid.flat())
  const bw = pw / BINS
  const rowsTop = LINE_H + 28
  const H = rowsTop + CATEGORIES.length * (ROW + GAP) + 20
  const y = (n: number) => LINE_H - (n / a.eventCount) * (LINE_H - 10)
  const path = cum.map((n, i) => `${i ? 'L' : 'M'}${L + (i + 1) * bw},${y(n)}`).join(' ')
  const tAt = (i: number) => new Date(a.start + ((i + 1) / BINS) * span)
  const fmtT = (d: Date) => span > 2 * 86_400_000 ? d.toLocaleDateString() : d.toLocaleTimeString()
  const used = CATEGORIES.filter((_, ci) => grid[ci].some(Boolean))
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        {num(a.eventCount)} events over {dur(a.durationMs)}. Top: cumulative event count. Below: event density per category ({BINS} time buckets; darker = more events, red ticks = failures or timeouts).
      </p>
      <div style={{ position: 'relative' }}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Event timeline" onMouseLeave={() => setHover(null)}
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect()
            const x = ((e.clientX - r.left) / r.width) * W - L
            setHover(x < 0 || x > pw ? null : Math.min(BINS - 1, Math.floor(x / bw)))
          }}>
          {[0, 0.5, 1].map(f => (
            <g key={f}>
              <line className="grid-line" x1={L} x2={W - R} y1={y(f * a.eventCount)} y2={y(f * a.eventCount)} />
              <text x={L - 8} y={y(f * a.eventCount) + 4} textAnchor="end">{num(f * a.eventCount)}</text>
            </g>
          ))}
          <path d={`${path} L${W - R},${LINE_H} L${L},${LINE_H} Z`} fill="var(--accent)" opacity={0.12} />
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
          {CATEGORIES.map((c, ci) => {
            const top = rowsTop + ci * (ROW + GAP)
            return (
              <g key={c}>
                <text x={L - 8} y={top + ROW / 2 + 4} textAnchor="end" style={{ fill: grid[ci].some(Boolean) ? 'var(--text)' : 'var(--muted)' }}>{c}</text>
                <rect x={L} y={top} width={pw} height={ROW} rx={4} fill="var(--panel-2)" />
                {grid[ci].map((n, i) => n > 0 && (
                  <rect key={i} x={L + i * bw} y={top} width={Math.max(bw - 0.5, 1)} height={ROW} fill={CAT_COLOR[c]}
                    opacity={0.35 + 0.65 * Math.sqrt(n / maxBin)} />
                ))}
              </g>
            )
          })}
          {fails.map((n, i) => n > 0 && <rect key={i} x={L + i * bw + bw / 2 - 1.5} y={rowsTop - 10} width={3} height={8} rx={1.5} fill="var(--bad)" />)}
          <text x={L} y={H - 4}>{fmtT(new Date(a.start))}</text>
          <text x={W - R} y={H - 4} textAnchor="end">{fmtT(new Date(a.end))}</text>
          {hover !== null && <line x1={L + (hover + 0.5) * bw} x2={L + (hover + 0.5) * bw} y1={0} y2={H - 16} stroke="var(--muted)" strokeDasharray="3 3" />}
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: `${((L + (hover + 0.5) * bw) / W) * 100}%`, top: 0 }}>
            <strong>{tAt(hover).toLocaleString()}</strong><br />
            {num(cum[hover])} events so far
            {used.map(c => { const n = grid[CATEGORIES.indexOf(c)][hover]; return n ? <div key={c}><span style={{ color: CAT_COLOR[c] }}>■</span> {c}: {n}</div> : null })}
            {fails[hover] > 0 && <div style={{ color: 'var(--bad)' }}>{fails[hover]} failure(s)</div>}
          </div>
        )}
      </div>
    </div>
  )
}
