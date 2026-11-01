// Pure analysis of Temporal Workflow Event Histories (proto-JSON as exported by
// `temporal workflow show --output json`, the Web UI, or the SDK replayers).

type Obj = Record<string, any>

export const LIMITS = {
  eventsWarn: 10_240,
  eventsMax: 51_200,
  bytesWarn: 10 * 1024 * 1024,
  bytesMax: 50 * 1024 * 1024,
  payloadMax: 2 * 1024 * 1024,
  grpcMax: 4 * 1024 * 1024,
  signalsMax: 10_000,
}

export const DOCS = {
  actions: 'https://docs.temporal.io/cloud/actions',
  limits: 'https://docs.temporal.io/cloud/limits',
  pricing: 'https://docs.temporal.io/cloud/pricing',
  can: 'https://docs.temporal.io/workflow-execution/continue-as-new',
  externalStorage: 'https://docs.temporal.io/external-storage',
  blobSize: 'https://docs.temporal.io/troubleshooting/blob-size-limit-error',
  localActivity: 'https://docs.temporal.io/local-activity',
  messages: 'https://docs.temporal.io/encyclopedia/workflow-message-passing',
  heartbeat: 'https://docs.temporal.io/encyclopedia/detecting-activity-failures#activity-heartbeat',
  retry: 'https://docs.temporal.io/encyclopedia/retry-policies',
  events: 'https://docs.temporal.io/workflow-execution/event',
}

export interface Ev { id: number; type: string; time: number; attrs: Obj; bytes: number }

export type Category = 'Workflow' | 'Workflow task' | 'Activity' | 'Timer' | 'Signals & updates' | 'Child & Nexus' | 'Other'
export const CATEGORIES: Category[] = ['Workflow', 'Workflow task', 'Activity', 'Timer', 'Signals & updates', 'Child & Nexus', 'Other']

export interface Payload { eventId: number; source: string; field: string; bytes: number; encoding: string }
export interface ActionRow { kind: string; count: number; note: string }
export interface ActivityStats {
  type: string; scheduled: number; attempts: number; retries: number; maxAttempt: number
  completed: number; failed: number; timedOut: number; canceled: number; pending: number
  medianMs: number | null; heartbeatTimeoutS: number; heartbeatEstimate: number
  workflowTasks: number; unlimitedRetries: boolean; lastFailure: string; retryFailure: string; timeoutTypes: string[]
}
export interface Rec { severity: 'bad' | 'warn' | 'info'; title: string; detail: string; doc: string; docLabel: string }

export interface Analysis {
  name: string
  workflowType: string; workflowId: string; runId: string; taskQueue: string; status: string
  start: number; end: number; durationMs: number
  eventCount: number; jsonBytes: number
  historyBytes: number; historyBytesReported: boolean; historyBytesAtEvent: number
  payloadBytes: number; payloadCount: number; payloads: Payload[]
  payloadSources: { source: string; field: string; count: number; bytes: number; max: number }[]
  actions: ActionRow[]; totalActions: number; heartbeatEstimate: number
  activities: ActivityStats[]
  signals: { name: string; count: number; bytes: number }[]
  timers: number; workflowTaskFailures: { cause: string; count: number }[]
  suggestContinueAsNew: boolean
  timeline: { time: number; cat: Category; failed: boolean }[]
  recs: Rec[]
}

// ---------- parsing ----------

export function eventTypeName(t: unknown): string {
  if (typeof t !== 'string' || !t) throw new Error('event is missing a string "eventType"')
  if (t.startsWith('EVENT_TYPE_')) return t.slice(11).toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase())
  return t[0].toUpperCase() + t.slice(1)
}

function toMs(t: unknown): number {
  if (typeof t === 'string') return Date.parse(t)
  if (t && typeof t === 'object' && 'seconds' in t) return Number((t as Obj).seconds) * 1000 + Number((t as Obj).nanos ?? 0) / 1e6
  return NaN
}

/** Parse a duration like "10s", "1.5s", "0s" or {seconds, nanos} into seconds. */
export function durS(d: unknown): number {
  if (typeof d === 'string') return parseFloat(d) || 0
  if (d && typeof d === 'object') return Number((d as Obj).seconds ?? 0) + Number((d as Obj).nanos ?? 0) / 1e9
  return 0
}

export function parseHistory(text: string): Ev[] {
  if (!text.trim()) throw new Error('Input is empty.')
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (e) {
    // `temporal workflow show --output jsonl` prints one event per line.
    const lines = text.split('\n').filter(l => l.trim())
    try { root = lines.map(l => JSON.parse(l)) } catch {
      throw new Error(`Not valid JSON: ${(e as Error).message}`)
    }
  }
  const r = root as Obj
  const raw: unknown = Array.isArray(root) ? root : r?.eventType ? [root] : r?.events ?? r?.history?.events
  if (!Array.isArray(raw)) throw new Error('Expected a history: {"events": [...]}, {"history": {"events": [...]}} or an array of events.')
  if (!raw.length) throw new Error('History contains no events.')
  return raw.map((e: Obj, i) => {
    if (!e || typeof e !== 'object') throw new Error(`Event #${i + 1} is not an object.`)
    let type: string
    try { type = eventTypeName(e.eventType) } catch (err) { throw new Error(`Event #${i + 1}: ${(err as Error).message}.`) }
    const key = Object.keys(e).find(k => k.endsWith('EventAttributes') && e[k] && typeof e[k] === 'object')
    const time = toMs(e.eventTime)
    if (Number.isNaN(time)) throw new Error(`Event ${e.eventId ?? i + 1} (${type}) has no valid "eventTime".`)
    return { id: Number(e.eventId ?? i + 1), type, time, attrs: (key ? e[key] : e.attributes) ?? {}, bytes: JSON.stringify(e).length }
  })
}

// ---------- helpers ----------

export function b64Bytes(s: string): number {
  let pad = 0
  if (s.endsWith('==')) pad = 2
  else if (s.endsWith('=')) pad = 1
  return Math.floor((s.length * 3) / 4) - pad
}

function decode(s: unknown): string {
  try { return typeof s === 'string' ? atob(s) : '' } catch { return '' }
}

function payloadSize(p: Obj): number {
  const meta = Object.values(p.metadata ?? {}).reduce((n: number, v) => n + (typeof v === 'string' ? b64Bytes(v) : 0), 0)
  const d = p.data
  const data = typeof d === 'string' ? (/^[A-Za-z0-9+/_-]*={0,2}$/.test(d) ? b64Bytes(d) : d.length) : JSON.stringify(d ?? '').length
  return meta + data
}

/** Find every Payload ({metadata, data}) inside an attributes object, with its path. */
function walkPayloads(o: unknown, path: string[], out: { path: string[]; p: Obj }[]) {
  if (!o || typeof o !== 'object') return
  if (Array.isArray(o)) { o.forEach(v => walkPayloads(v, path, out)); return }
  const obj = o as Obj
  if ('data' in obj && obj.metadata && typeof obj.metadata === 'object') { out.push({ path, p: obj }); return }
  for (const k in obj) walkPayloads(obj[k], [...path, k], out)
}

const FIELD_LABELS: Record<string, string> = {
  input: 'input', result: 'result', memo: 'memo', upsertedMemo: 'memo', header: 'header', searchAttributes: 'search attributes',
  failure: 'failure details', lastFailure: 'failure details', continuedFailure: 'previous run failure',
  lastCompletionResult: 'last completion result', details: 'details', lastHeartbeatDetails: 'heartbeat details',
  acceptedRequest: 'input', outcome: 'result', heartbeatDetails: 'heartbeat details',
}

export function category(type: string): Category {
  if (type.startsWith('WorkflowTask')) return 'Workflow task'
  if (type.startsWith('ActivityTask')) return 'Activity'
  if (type.startsWith('Timer')) return 'Timer'
  if (type === 'WorkflowExecutionSignaled' || type.startsWith('SignalExternal') || type.startsWith('ExternalWorkflowExecutionSignaled') || type.startsWith('WorkflowExecutionUpdate')) return 'Signals & updates'
  if (/Child|Nexus|External/.test(type)) return 'Child & Nexus'
  if (type.startsWith('WorkflowExecution')) return 'Workflow'
  return 'Other'
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// ---------- analysis ----------

export function analyze(events: Ev[], name = 'history'): Analysis {
  const byId = new Map(events.map(e => [e.id, e]))
  const first = events[0]
  const last = events[events.length - 1]
  const startAttrs = first.type === 'WorkflowExecutionStarted' ? first.attrs : {}
  const isChild = !!startAttrs.parentWorkflowExecution?.workflowId
  const scheduled = !!startAttrs.searchAttributes?.indexedFields?.TemporalScheduledById

  // Activity bookkeeping keyed by scheduledEventId.
  const actTypeOf = (schedId: unknown) => byId.get(Number(schedId))?.attrs.activityType?.name ?? 'unknown'
  const stats = new Map<string, ActivityStats & { durations: number[]; wts: Set<number> }>()
  const act = (type: string) => {
    let s = stats.get(type)
    if (!s) {
      s = { type, scheduled: 0, attempts: 0, retries: 0, maxAttempt: 0, completed: 0, failed: 0, timedOut: 0, canceled: 0, pending: 0,
        medianMs: null, heartbeatTimeoutS: 0, heartbeatEstimate: 0, workflowTasks: 0, unlimitedRetries: false, lastFailure: '', retryFailure: '',
        timeoutTypes: [], durations: [], wts: new Set() }
      stats.set(type, s)
    }
    return s
  }
  const startedBySched = new Map<number, Ev>()
  const closedSched = new Set<number>()

  const signals = new Map<string, { name: string; count: number; bytes: number }>()
  const markerTasks = new Set<string>()
  const wtfCauses = new Map<string, number>()
  const counts: Record<string, number> = {}
  const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n }
  const payloads: Payload[] = []
  let timers = 0, suggestCAN = false, reported = 0, reportedAt = 0, sws = false

  for (const e of events) {
    const a = e.attrs
    switch (e.type) {
      case 'WorkflowExecutionStarted':
        if (!isChild) bump('Workflow started')
        if (scheduled) bump('Schedule execution')
        break
      case 'ActivityTaskScheduled': {
        const s = act(a.activityType?.name ?? 'unknown')
        s.scheduled++
        s.heartbeatTimeoutS = Math.max(s.heartbeatTimeoutS, durS(a.heartbeatTimeout))
        const rp = a.retryPolicy
        if (!Number(rp?.maximumAttempts) && !durS(a.scheduleToCloseTimeout)) s.unlimitedRetries = true
        s.wts.add(Number(a.workflowTaskCompletedEventId))
        break
      }
      case 'ActivityTaskStarted': {
        startedBySched.set(Number(a.scheduledEventId), e)
        const s = act(actTypeOf(a.scheduledEventId))
        const attempt = Number(a.attempt ?? 1) || 1
        s.attempts += attempt
        s.retries += attempt - 1
        s.maxAttempt = Math.max(s.maxAttempt, attempt)
        if (a.lastFailure?.message) s.lastFailure = s.retryFailure = a.lastFailure.message
        break
      }
      case 'ActivityTaskCompleted': case 'ActivityTaskFailed': case 'ActivityTaskTimedOut': case 'ActivityTaskCanceled': {
        const sid = Number(a.scheduledEventId)
        closedSched.add(sid)
        const s = act(actTypeOf(sid))
        const st = startedBySched.get(sid)
        if (st) {
          const d = e.time - st.time
          s.durations.push(d)
          if (s.heartbeatTimeoutS > 0) {
            // SDKs throttle heartbeats to min(80% of heartbeat timeout, 60s): upper bound for the final attempt.
            s.heartbeatEstimate += Math.floor(d / 1000 / Math.min(0.8 * s.heartbeatTimeoutS, 60))
          }
        }
        if (e.type === 'ActivityTaskCompleted') s.completed++
        if (e.type === 'ActivityTaskFailed') { s.failed++; if (a.failure?.message) s.lastFailure = a.failure.message }
        if (e.type === 'ActivityTaskTimedOut') {
          s.timedOut++
          const tt = String(a.failure?.timeoutFailureInfo?.timeoutType ?? 'TIMEOUT').replace('TIMEOUT_TYPE_', '')
          if (!s.timeoutTypes.includes(tt)) s.timeoutTypes.push(tt)
          const cause = a.failure?.cause?.message
          if (cause) s.lastFailure = cause
        }
        if (e.type === 'ActivityTaskCanceled') s.canceled++
        break
      }
      case 'TimerStarted': timers++; bump('Timer started'); break
      case 'WorkflowExecutionSignaled': {
        const n = a.signalName ?? 'unknown'
        const s = signals.get(n) ?? { name: n, count: 0, bytes: 0 }
        s.count++
        signals.set(n, s)
        // Signal-With-Start: the signal lands right after the start event and is billed as one Action with it.
        if (e.id === 2 && first.type === 'WorkflowExecutionStarted' && !isChild) sws = true
        else bump('Signal received')
        break
      }
      case 'SignalExternalWorkflowExecutionInitiated': bump('Signal sent to another workflow'); break
      case 'StartChildWorkflowExecutionInitiated': bump('Child workflow started', 2); break
      case 'UpsertWorkflowSearchAttributes': {
        const keys = Object.keys(a.searchAttributes?.indexedFields ?? {})
        if (keys.some(k => k !== 'TemporalChangeVersion')) bump('Search attributes upserted')
        break
      }
      case 'MarkerRecorded': markerTasks.add(String(a.workflowTaskCompletedEventId ?? e.id)); break
      case 'WorkflowExecutionUpdateAccepted': bump('Update accepted'); break
      case 'NexusOperationScheduled': bump('Nexus operation scheduled'); break
      case 'NexusOperationCancelRequested': bump('Nexus cancel requested'); break
      case 'WorkflowExecutionOptionsUpdated': bump('Workflow options updated'); break
      case 'WorkflowTaskStarted':
        if (a.suggestContinueAsNew) suggestCAN = true
        if (Number(a.historySizeBytes) > 0) { reported = Number(a.historySizeBytes); reportedAt = e.id }
        break
      case 'WorkflowTaskFailed': case 'WorkflowTaskTimedOut': {
        const c = String(a.cause ?? (e.type === 'WorkflowTaskTimedOut' ? 'TIMED_OUT' : 'UNSPECIFIED')).replace('WORKFLOW_TASK_FAILED_CAUSE_', '')
        wtfCauses.set(c, (wtfCauses.get(c) ?? 0) + 1)
        break
      }
    }

    // Payloads
    const found: { path: string[]; p: Obj }[] = []
    walkPayloads(a, [], found)
    for (const { path, p } of found) {
      const bytes = payloadSize(p)
      const field = FIELD_LABELS[path[0]] ?? path[0] ?? ''
      payloads.push({ eventId: e.id, source: payloadSource(e, byId), field, bytes, encoding: decode(p.metadata?.encoding) || '?' })
      if (e.type === 'WorkflowExecutionSignaled') signals.get(a.signalName ?? 'unknown')!.bytes += bytes
    }
  }

  // Activities still in flight: scheduled with no close event.
  for (const e of events) if (e.type === 'ActivityTaskScheduled' && !closedSched.has(e.id)) act(e.attrs.activityType?.name ?? 'unknown').pending++

  if (markerTasks.size) bump('Markers (local activities, side effects, versions)', markerTasks.size)

  const activities = [...stats.values()].map(({ durations, wts, ...s }) => ({ ...s, medianMs: median(durations), workflowTasks: wts.size }))
    .sort((x, y) => y.attempts - x.attempts)
  const attempts = activities.reduce((n, s) => n + s.attempts, 0)
  if (attempts) counts['Activity started or retried'] = attempts
  const heartbeatEstimate = activities.reduce((n, s) => n + s.heartbeatEstimate, 0)

  const NOTES: Record<string, string> = {
    'Workflow started': 'Includes runs started by Continue-As-New.',
    'Schedule execution': 'Each Schedule execution adds two Actions beyond the Workflow start.',
    'Activity started or retried': 'Every attempt counts, taken from the attempt number of each started event.',
    'Timer started': 'Includes timers the SDK starts implicitly (e.g. sleep, condition timeouts).',
    'Signal received': '',
    'Signal sent to another workflow': 'Billed once per Signal; if you also load the receiving history, this Signal appears there too.',
    'Child workflow started': 'Two Actions: recording the intent and attempting the start.',
    'Search attributes upserted': 'One per upsert command; TemporalChangeVersion-only upserts are excluded.',
    'Markers (local activities, side effects, versions)': 'All markers recorded in one Workflow Task count as a single Action.',
    'Update accepted': 'Rejected Updates are also billed but are not written to history.',
  }
  const actions: ActionRow[] = Object.entries(counts).map(([kind, count]) => ({ kind, count, note: NOTES[kind] ?? '' }))
    .sort((x, y) => y.count - x.count)
  if (isChild) actions.push({ kind: 'Workflow started', count: 0, note: 'Child workflow: its start is billed to the parent (StartChildWorkflow = 2 Actions).' })
  if (sws) actions.push({ kind: 'Signal-With-Start', count: 0, note: 'The first Signal was delivered with the start and billed as one Action with it.' })
  const totalActions = actions.reduce((n, r) => n + r.count, 0)

  const status = /^WorkflowExecution(Completed|Failed|TimedOut|Canceled|Terminated|ContinuedAsNew)$/.exec(last.type)?.[1] ?? 'Running'
  const payloadBytes = payloads.reduce((n, p) => n + p.bytes, 0)
  const jsonBytes = events.reduce((n, e) => n + e.bytes, 0)
  const groups = new Map<string, Analysis['payloadSources'][number]>()
  for (const p of payloads) {
    const k = p.source + '|' + p.field
    const g = groups.get(k) ?? { source: p.source, field: p.field, count: 0, bytes: 0, max: 0 }
    g.count++; g.bytes += p.bytes; g.max = Math.max(g.max, p.bytes)
    groups.set(k, g)
  }

  const out: Analysis = {
    name,
    workflowType: startAttrs.workflowType?.name ?? 'unknown',
    workflowId: startAttrs.workflowId ?? '',
    runId: startAttrs.originalExecutionRunId ?? startAttrs.firstExecutionRunId ?? '',
    taskQueue: startAttrs.taskQueue?.name ?? '',
    status: status === 'ContinuedAsNew' ? 'Continued-As-New' : status === 'TimedOut' ? 'Timed out' : status,
    start: first.time, end: last.time, durationMs: last.time - first.time,
    eventCount: events.length, jsonBytes,
    // Prefer the server's own measurement; otherwise the exported JSON size is a conservative upper bound.
    historyBytes: reported || jsonBytes, historyBytesReported: !!reported, historyBytesAtEvent: reportedAt,
    payloadBytes, payloadCount: payloads.length, payloads: payloads.sort((x, y) => y.bytes - x.bytes).slice(0, 100),
    payloadSources: [...groups.values()].sort((x, y) => y.bytes - x.bytes),
    actions, totalActions, heartbeatEstimate, activities,
    signals: [...signals.values()].sort((x, y) => y.count - x.count),
    timers,
    workflowTaskFailures: [...wtfCauses].map(([cause, count]) => ({ cause, count })),
    suggestContinueAsNew: suggestCAN,
    timeline: events.map(e => ({ time: e.time, cat: category(e.type), failed: /Failed|TimedOut|Terminated/.test(e.type) })),
    recs: [],
  }
  out.recs = recommend(out)
  return out
}

function payloadSource(e: Ev, byId: Map<number, Ev>): string {
  const a = e.attrs
  const actType = () => byId.get(Number(a.scheduledEventId))?.attrs.activityType?.name ?? 'unknown'
  const childType = () => a.workflowType?.name ?? byId.get(Number(a.initiatedEventId))?.attrs.workflowType?.name ?? 'unknown'
  const upd = () => a.acceptedRequest?.input?.name ?? a.meta?.updateId ?? ''
  switch (e.type) {
    case 'WorkflowExecutionStarted': return 'Workflow start'
    case 'WorkflowExecutionCompleted': return 'Workflow result'
    case 'WorkflowExecutionFailed': return 'Workflow failure'
    case 'WorkflowExecutionContinuedAsNew': return 'Continue-As-New'
    case 'ActivityTaskScheduled': return `Activity · ${a.activityType?.name ?? 'unknown'}`
    case 'ActivityTaskStarted': case 'ActivityTaskCompleted': case 'ActivityTaskFailed': case 'ActivityTaskTimedOut': case 'ActivityTaskCanceled':
      return `Activity · ${actType()}`
    case 'WorkflowExecutionSignaled': return `Signal · ${a.signalName ?? 'unknown'}`
    case 'SignalExternalWorkflowExecutionInitiated': return `Signal sent · ${a.signalName ?? 'unknown'}`
    case 'StartChildWorkflowExecutionInitiated': case 'ChildWorkflowExecutionCompleted': case 'ChildWorkflowExecutionFailed':
      return `Child workflow · ${childType()}`
    case 'MarkerRecorded': return `Marker · ${a.markerName ?? 'unknown'}`
    case 'WorkflowExecutionUpdateAccepted': case 'WorkflowExecutionUpdateCompleted': return `Update${upd() ? ' · ' + upd() : ''}`
    case 'UpsertWorkflowSearchAttributes': return 'Search attribute upsert'
    case 'WorkflowPropertiesModified': return 'Memo upsert'
    default: return e.type
  }
}

// ---------- projection ----------

export interface Projection { eventsPerDay: number; bytesPerDay: number; daysTo: Record<'eventsWarn' | 'eventsMax' | 'bytesWarn' | 'bytesMax', number | null> }

/** Linear growth over the observed wall-clock span; null when the span is too short to extrapolate. */
export function project(a: Analysis): Projection | null {
  const days = a.durationMs / 86_400_000
  if (days < 1 / 1440 || a.eventCount < 2) return null
  const eventsPerDay = a.eventCount / days
  const bytesPerDay = a.historyBytes / days
  const t = (have: number, limit: number, rate: number) => (have >= limit ? 0 : rate > 0 ? (limit - have) / rate : null)
  return {
    eventsPerDay, bytesPerDay,
    daysTo: {
      eventsWarn: t(a.eventCount, LIMITS.eventsWarn, eventsPerDay),
      eventsMax: t(a.eventCount, LIMITS.eventsMax, eventsPerDay),
      bytesWarn: t(a.historyBytes, LIMITS.bytesWarn, bytesPerDay),
      bytesMax: t(a.historyBytes, LIMITS.bytesMax, bytesPerDay),
    },
  }
}

// ---------- recommendations ----------

export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(2)} MB`

export function recommend(a: Analysis): Rec[] {
  const recs: Rec[] = []
  const p = project(a)
  const running = a.status === 'Running'
  const evShare = a.eventCount / LIMITS.eventsWarn
  const sizeShare = a.historyBytes / LIMITS.bytesWarn
  const soon = p && running && Math.min(p.daysTo.eventsMax ?? Infinity, p.daysTo.bytesMax ?? Infinity) < 90

  if (a.suggestContinueAsNew || evShare >= 0.5 || sizeShare >= 0.5 || soon) {
    const why = [
      a.suggestContinueAsNew && 'the server already set suggestContinueAsNew',
      evShare >= 0.5 && `${a.eventCount.toLocaleString()} events (${Math.round(evShare * 100)}% of the ${LIMITS.eventsWarn.toLocaleString()} warning threshold)`,
      sizeShare >= 0.5 && `${fmtBytes(a.historyBytes)} of history (${Math.round(sizeShare * 100)}% of the 10 MB warning)`,
      soon && `at the current rate it reaches a hard limit in ~${Math.round(Math.min(p!.daysTo.eventsMax ?? Infinity, p!.daysTo.bytesMax ?? Infinity))} days`,
    ].filter(Boolean).join('; ')
    recs.push({
      severity: evShare >= 1 || sizeShare >= 1 || a.suggestContinueAsNew ? 'bad' : 'warn',
      title: 'Use Continue-As-New to bound history growth',
      detail: `This run has ${why}. Continue-As-New periodically (e.g. when workflow.info() reports suggestContinueAsNew, or every N iterations), carrying only the state you need into the new run. Histories that hit 51,200 events or 50 MB are terminated.`,
      doc: DOCS.can, docLabel: 'Continue-As-New',
    })
  }

  const big = a.payloads.filter(x => x.bytes >= 256 * 1024)
  if (big.length || a.payloadBytes > 0.4 * a.historyBytes && a.payloadBytes > 1024 * 1024) {
    const top = a.payloads[0]
    const near = big.some(x => x.bytes >= LIMITS.payloadMax * 0.5)
    recs.push({
      severity: near ? 'bad' : 'warn',
      title: 'Offload large payloads (claim-check / External Storage)',
      detail: `${big.length} payload(s) are 256 KB or larger; the largest is ${fmtBytes(top.bytes)} (${top.source}, ${top.field}), ${Math.round((top.bytes / LIMITS.payloadMax) * 100)}% of the 2 MB per-payload limit. Payloads make up ${fmtBytes(a.payloadBytes)} of this history. Store the blob in S3/GCS/a database and pass a reference, or enable External Storage, so history and replay stay small.`,
      doc: DOCS.externalStorage, docLabel: 'External Storage',
    })
  }

  for (const s of a.activities) {
    if (s.retries >= 5 || s.maxAttempt >= 5) {
      recs.push({
        severity: s.retries >= 20 || (s.unlimitedRetries && s.retries >= 10) ? 'bad' : 'warn',
        title: `Tune the retry policy for ${s.type}`,
        detail: `${s.retries} retries across ${s.scheduled} execution(s) (max attempt ${s.maxAttempt}), each one a billable Action${s.retryFailure ? `; retried on: "${s.retryFailure}"` : ''}${s.lastFailure && s.lastFailure !== s.retryFailure ? `; final outcome: "${s.lastFailure}"` : ''}. ${s.unlimitedRetries ? 'The policy has unlimited attempts and no schedule-to-close timeout. ' : ''}Set maximumAttempts or a schedule-to-close timeout, raise the backoff, and mark permanent errors (validation, declined cards) as non-retryable.`,
        doc: DOCS.retry, docLabel: 'Retry Policies',
      })
    }
  }

  const laCandidates = a.activities.filter(s => s.scheduled >= 5 && s.medianMs !== null && s.medianMs < 2000 && !s.heartbeatTimeoutS)
  const laSaved = laCandidates.reduce((n, s) => n + Math.max(0, s.attempts - s.workflowTasks), 0)
  // A Local Activity replaces scheduled/started/completed with one marker, inside the same Workflow Task.
  const laEvents = laCandidates.reduce((n, s) => n + 2 * s.scheduled, 0)
  if (laCandidates.length) {
    recs.push({
      severity: laSaved > 100 || laEvents > 0.2 * a.eventCount ? 'warn' : 'info',
      title: 'Run short activities as Local Activities',
      detail: `${laCandidates.map(s => `${s.type} (${s.scheduled}×, median ${s.medianMs} ms)`).join(', ')} finish quickly and never heartbeat. As Local Activities each execution records one marker instead of three events (~${laEvents.toLocaleString()} fewer events here, ${Math.round((laEvents / a.eventCount) * 100)}% of the history)${laSaved > 0 ? `, and all Local Activities in one Workflow Task bill as a single Action (~${laSaved.toLocaleString()} fewer Actions)` : ''}. Only do this for short, idempotent calls that tolerate re-execution.`,
      doc: DOCS.localActivity, docLabel: 'Local Activities',
    })
  }

  const sigTotal = a.signals.reduce((n, s) => n + s.count, 0)
  if (sigTotal >= 100) {
    recs.push({
      severity: sigTotal >= LIMITS.signalsMax * 0.5 ? 'bad' : 'warn',
      title: 'Batch signals',
      detail: `${sigTotal.toLocaleString()} signals received (${a.signals.slice(0, 3).map(s => `${s.name}: ${s.count}`).join(', ')}). Each is an Action and adds at least one event; one execution can accept at most 10,000. Aggregate on the sender side (one signal per batch or time window), or use Continue-As-New so each run takes a bounded number.`,
      doc: DOCS.messages, docLabel: 'Message passing',
    })
  }

  if (a.heartbeatEstimate >= 50) {
    const worst = [...a.activities].sort((x, y) => y.heartbeatEstimate - x.heartbeatEstimate)[0]
    recs.push({
      severity: a.heartbeatEstimate > a.totalActions ? 'warn' : 'info',
      title: 'Reduce heartbeat frequency',
      detail: `Heartbeats are not stored in history, but with a ${worst.heartbeatTimeoutS}s heartbeat timeout ${worst.type} can send up to ~${worst.heartbeatEstimate.toLocaleString()} billable heartbeats (upper bound: SDKs throttle to 80% of the timeout). Use a heartbeat timeout sized to how fast you need to detect a dead worker (often minutes, not seconds).`,
      doc: DOCS.heartbeat, docLabel: 'Activity Heartbeats',
    })
  }

  const wtf = a.workflowTaskFailures.reduce((n, x) => n + x.count, 0)
  if (wtf) {
    recs.push({
      severity: a.workflowTaskFailures.some(x => /NON_DETERMINISTIC/.test(x.cause)) || wtf >= 3 ? 'bad' : 'warn',
      title: 'Investigate Workflow Task failures',
      detail: `${wtf} Workflow Task failure(s)/timeout(s): ${a.workflowTaskFailures.map(x => `${x.cause} ×${x.count}`).join(', ')}. These retry forever and add events on every attempt. Non-determinism usually means code changed without versioning; timeouts often mean blocked or overloaded workers.`,
      doc: DOCS.events, docLabel: 'Events',
    })
  }

  if (!recs.length) recs.push({
    severity: 'info', title: 'No issues found',
    detail: 'History size, payloads, retries and Action mix are all comfortably within limits for this run.',
    doc: DOCS.limits, docLabel: 'Limits',
  })
  const order = { bad: 0, warn: 1, info: 2 }
  return recs.sort((x, y) => order[x.severity] - order[y.severity])
}
