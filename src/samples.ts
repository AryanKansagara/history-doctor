// Realistic sample histories in the same shape the Temporal CLI / Web UI export.

type Obj = Record<string, any>

const b64 = (s: string) => btoa(s)
const ENC = b64('json/plain')
const payload = (v: unknown) => ({ payloads: [{ metadata: { encoding: ENC }, data: b64(JSON.stringify(v)) }] })
/** A JSON payload of roughly `bytes` decoded size. */
const blob = (bytes: number, label: string) => payload({ kind: label, data: 'x'.repeat(Math.max(0, bytes - label.length - 22)) })

const snake = (t: string) => t.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()

/** Event builder. `style` picks proto enum names (CLI) or the older PascalCase names (Web UI / older CLI). */
function history(startMs: number, style: 'proto' | 'pascal', taskQueue: string) {
  const events: Obj[] = []
  let t = startMs
  const tq = { name: taskQueue, kind: style === 'proto' ? 'TASK_QUEUE_KIND_NORMAL' : 'Normal' }
  let jsonSoFar = 0
  const add = (type: string, attrs: Obj, afterMs = 0) => {
    t += afterMs
    const id = events.length + 1
    const ev = {
      eventId: String(id),
      eventTime: new Date(t).toISOString(),
      eventType: style === 'proto' ? 'EVENT_TYPE_' + snake(type) : type,
      taskId: String(1_048_576 + id * 3),
      [type[0].toLowerCase() + type.slice(1) + 'EventAttributes']: attrs,
    }
    events.push(ev)
    jsonSoFar += JSON.stringify(ev).length
    return id
  }
  const identity = `41872@worker-${taskQueue}-7d9f8@`
  /** Workflow task: scheduled, started, completed. Returns the completed event id. */
  const wt = (afterMs = 5, reportSize = false) => {
    const s = add('WorkflowTaskScheduled', { taskQueue: tq, startToCloseTimeout: '10s', attempt: 1 }, afterMs)
    const st = add('WorkflowTaskStarted', {
      scheduledEventId: String(s), identity, requestId: crypto.randomUUID(),
      // Real servers report the proto-encoded size; payload bytes dominate, so approximate it.
      ...(reportSize ? { historySizeBytes: String(Math.round(jsonSoFar * 0.76)) } : {}),
      // The server suggests Continue-As-New past its default soft thresholds (4K events / 4 MB).
      ...(reportSize && (events.length > 4096 || jsonSoFar * 0.76 > 4 * 1024 * 1024) ? { suggestContinueAsNew: true } : {}),
    }, 4)
    return add('WorkflowTaskCompleted', { scheduledEventId: String(s), startedEventId: String(st), identity }, 12)
  }
  const activity = (wtId: number, type: string, input: unknown, o: { attempt?: number; hb?: string; lastFailure?: string; retry?: Obj; latency?: number } = {}) => {
    const sid = add('ActivityTaskScheduled', {
      activityId: String(events.length + 1), activityType: { name: type }, taskQueue: tq, header: {},
      input: payload(input), scheduleToCloseTimeout: '0s', scheduleToStartTimeout: '0s', startToCloseTimeout: '30s',
      ...(o.hb ? { heartbeatTimeout: o.hb } : {}), workflowTaskCompletedEventId: String(wtId),
      retryPolicy: o.retry ?? { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '100s', maximumAttempts: 0 },
    })
    const st = add('ActivityTaskStarted', {
      scheduledEventId: String(sid), identity, requestId: crypto.randomUUID(), attempt: o.attempt ?? 1,
      ...(o.lastFailure ? { lastFailure: { message: o.lastFailure, source: 'TypeScriptSDK', applicationFailureInfo: { type: 'Error' } } } : {}),
    }, o.latency ?? 8)
    return { sid, st }
  }
  const complete = (sid: number, st: number, result: Obj, ms: number) =>
    add('ActivityTaskCompleted', { result, scheduledEventId: String(sid), startedEventId: String(st), identity }, ms)
  const start = (workflowType: string, workflowId: string, input: unknown, extra: Obj = {}) => {
    const runId = crypto.randomUUID()
    add('WorkflowExecutionStarted', {
      workflowType: { name: workflowType }, taskQueue: tq, input: payload(input), workflowExecutionTimeout: '0s', workflowRunTimeout: '0s',
      workflowTaskTimeout: '10s', originalExecutionRunId: runId, identity: '1@client@', firstExecutionRunId: runId, attempt: 1,
      firstWorkflowTaskBackoff: '0s', header: {}, workflowId, ...extra,
    })
  }
  return { events, add, wt, activity, complete, start, now: () => t }
}

const HOUR = 3_600_000, DAY = 24 * HOUR

/** (a) Healthy order fulfillment: a handful of activities, one timer, one signal. Web UI style. */
export function healthySample(): string {
  const h = history(Date.UTC(2026, 9, 28, 14, 2, 11), 'pascal', 'orders')
  h.start('OrderFulfillmentWorkflow', 'order-84213', { orderId: 'ord_84213', customerId: 'cus_1932', items: [{ sku: 'TSHIRT-M-BLK', qty: 2 }, { sku: 'MUG-LOGO', qty: 1 }], total: 58.5 })
  let w = h.wt()
  const steps: [string, unknown, unknown, number][] = [
    ['ValidateOrder', { orderId: 'ord_84213' }, { valid: true }, 42],
    ['ReserveInventory', { orderId: 'ord_84213', items: 2 }, { reservationId: 'res_771' }, 180],
    ['ChargePayment', { orderId: 'ord_84213', amount: 58.5, currency: 'USD' }, { chargeId: 'ch_3Pq9', status: 'succeeded' }, 640],
  ]
  for (const [type, input, result, ms] of steps) {
    const a = h.activity(w, type, input)
    h.complete(a.sid, a.st, payload(result), ms)
    w = h.wt()
  }
  const timer = h.add('TimerStarted', { timerId: '1', startToFireTimeout: '1800s', workflowTaskCompletedEventId: String(w) })
  h.add('WorkflowExecutionSignaled', { signalName: 'warehousePicked', input: payload({ warehouse: 'SFO-2', pickedBy: 'emp_55' }), identity: '1@warehouse-svc@' }, 22 * 60_000)
  w = h.wt()
  h.add('TimerCanceled', { timerId: '1', startedEventId: String(timer), workflowTaskCompletedEventId: String(w) })
  for (const [type, input, result, ms] of [
    ['CreateShipment', { orderId: 'ord_84213', carrier: 'UPS' }, { trackingNumber: '1Z999AA10123456784' }, 920],
    ['SendConfirmationEmail', { to: 'customer@example.com', template: 'order-shipped' }, { messageId: 'msg_01' }, 310],
  ] as [string, unknown, unknown, number][]) {
    const a = h.activity(w, type, input)
    h.complete(a.sid, a.st, payload(result), ms)
    w = h.wt()
  }
  h.add('WorkflowExecutionCompleted', { result: payload({ status: 'SHIPPED', trackingNumber: '1Z999AA10123456784' }), workflowTaskCompletedEventId: String(w) })
  return JSON.stringify({ events: h.events }, null, 2)
}

/** (b) Long-running subscription entity: thousands of signals, big state payloads, still running. CLI style. */
export function entitySample(): string {
  const started = Date.UTC(2026, 8, 20, 9, 0, 0)
  const h = history(started, 'proto', 'billing')
  h.start('SubscriptionWorkflow', 'subscription-acme-corp', { accountId: 'acct_acme', plan: 'enterprise' }, {
    memo: { fields: { account: blob(48 * 1024, 'account-profile').payloads[0] } },
  })
  let w = h.wt(5, true)
  const days = 41
  const signalsPerDay = 22
  for (let d = 0; d < days; d++) {
    // Daily entitlement sync, heartbeating every few seconds and returning the full state snapshot.
    const timer = h.add('TimerStarted', { timerId: `day-${d}`, startToFireTimeout: '86400s', workflowTaskCompletedEventId: String(w) })
    for (let s = 0; s < signalsPerDay; s++) {
      h.add('WorkflowExecutionSignaled', { signalName: 'usageReported', input: blob(1400 + (s % 7) * 90, 'usage-event'), identity: '1@metering@' }, Math.round(DAY / (signalsPerDay + 2)))
      w = h.wt(5, true)
      const a = h.activity(w, 'RecordUsage', { meter: 'api_calls' })
      h.complete(a.sid, a.st, payload({ ok: true }), 45 + (s % 5) * 11)
      w = h.wt(5, true)
    }
    h.add('TimerFired', { timerId: `day-${d}`, startedEventId: String(timer) }, HOUR)
    w = h.wt(5, true)
    const a = h.activity(w, 'SyncEntitlements', { accountId: 'acct_acme' }, { hb: '5s' })
    h.complete(a.sid, a.st, blob(96 * 1024, 'entitlement-snapshot'), 4 * 60_000)
    w = h.wt(5, true)
    if (d === 30) {
      const x = h.activity(w, 'ExportInvoiceHistory', { accountId: 'acct_acme', months: 36 })
      h.complete(x.sid, x.st, blob(1_720 * 1024, 'invoice-history'), 38_000)
      w = h.wt(5, true)
    }
    if (d % 10 === 0) {
      h.add('UpsertWorkflowSearchAttributes', { workflowTaskCompletedEventId: String(w), searchAttributes: { indexedFields: { BillingCycle: { metadata: { encoding: ENC, type: b64('Keyword') }, data: b64(`"2026-${10 + d / 10}"`) } } } })
    }
  }
  return JSON.stringify({ events: h.events })
}

/** (c) Payment workflow with a retry storm on a flaky processor, then compensation and failure. CLI style, wrapped. */
export function retryStormSample(): string {
  const h = history(Date.UTC(2026, 9, 30, 18, 40, 0), 'proto', 'payments')
  h.start('PaymentWorkflow', 'payment-inv-55120', { invoiceId: 'inv_55120', amount: 1299, currency: 'EUR' })
  let w = h.wt()
  const fraud = h.activity(w, 'FraudCheck', { invoiceId: 'inv_55120' }, { attempt: 4, lastFailure: 'fraud-svc: connection reset by peer', latency: 7_400 })
  h.complete(fraud.sid, fraud.st, payload({ score: 0.08, decision: 'allow' }), 210)
  w = h.wt()
  h.add('MarkerRecorded', { markerName: 'core_local_activity', details: { data: payload({ activityType: 'LookupFxRate', result: 1.0842 }) }, workflowTaskCompletedEventId: String(w) })
  const retry = { initialInterval: '1s', backoffCoefficient: 1.5, maximumInterval: '10s', maximumAttempts: 0 }
  // 62 attempts over ~10 minutes; the activity started event records only the final attempt.
  const charge = h.activity(w, 'ChargeCard', { invoiceId: 'inv_55120', amount: 1299, card: 'tok_visa_4242' }, {
    attempt: 62, retry, latency: 9 * 60_000 + 47_000, lastFailure: 'PaymentProcessorError: upstream 503 Service Unavailable (acquirer timeout)',
  })
  // After 61 retryable 503s the processor recovers and declines the card, which is non-retryable.
  h.add('ActivityTaskFailed', {
    failure: { message: 'CardDeclined: do_not_honor', source: 'TypeScriptSDK', applicationFailureInfo: { type: 'CardDeclined', nonRetryable: true } },
    scheduledEventId: String(charge.sid), startedEventId: String(charge.st), identity: 'payments-worker', retryState: 'RETRY_STATE_NON_RETRYABLE_FAILURE',
  }, 30_000)
  const s = h.add('WorkflowTaskScheduled', { taskQueue: { name: 'payments', kind: 'TASK_QUEUE_KIND_NORMAL' }, startToCloseTimeout: '10s', attempt: 1 }, 5)
  const st = h.add('WorkflowTaskStarted', { scheduledEventId: String(s), identity: 'payments-worker', requestId: crypto.randomUUID() }, 4)
  h.add('WorkflowTaskFailed', { scheduledEventId: String(s), startedEventId: String(st), cause: 'WORKFLOW_TASK_FAILED_CAUSE_WORKFLOW_WORKER_UNHANDLED_FAILURE', failure: { message: 'TypeError: Cannot read properties of undefined (reading \'chargeId\')' }, identity: 'payments-worker' }, 30)
  w = h.wt(2_000)
  for (const [type, attempt] of [['ReleaseFundsHold', 9], ['NotifyCustomer', 1]] as [string, number][]) {
    const a = h.activity(w, type, { invoiceId: 'inv_55120' }, { attempt, retry, latency: attempt > 1 ? 45_000 : 8, lastFailure: attempt > 1 ? 'acquirer: hold not found yet (eventual consistency)' : undefined })
    h.complete(a.sid, a.st, payload({ ok: true }), 300)
    w = h.wt()
  }
  h.add('WorkflowExecutionFailed', {
    failure: { message: 'Payment declined after 62 attempts: do_not_honor', source: 'TypeScriptSDK', applicationFailureInfo: { type: 'PaymentFailed', nonRetryable: true } },
    retryState: 'RETRY_STATE_RETRY_POLICY_NOT_SET', workflowTaskCompletedEventId: String(w),
  })
  return JSON.stringify({ history: { events: h.events } }, null, 2)
}

export const SAMPLES = [
  { id: 'healthy', label: 'Healthy order fulfillment', file: 'order-fulfillment.json', make: healthySample },
  { id: 'entity', label: 'Subscription entity near limits', file: 'subscription-entity.json', make: entitySample },
  { id: 'retry', label: 'Payment retry storm', file: 'payment-retry-storm.json', make: retryStormSample },
]
