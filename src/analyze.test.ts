import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, b64Bytes, eventTypeName, parseHistory, project } from './analyze.ts'
import { entitySample, healthySample, retryStormSample } from './samples.ts'

const ev = (id: number, type: string, attrs: object, sec = id) => ({
  eventId: String(id), eventTime: new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString(), eventType: type,
  [type.replace('EVENT_TYPE_', '').toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()) + 'EventAttributes']: attrs,
})
const p = (s: string) => ({ payloads: [{ metadata: { encoding: btoa('json/plain') }, data: btoa(s) }] })

test('event type names: proto enum and PascalCase', () => {
  assert.equal(eventTypeName('EVENT_TYPE_WORKFLOW_EXECUTION_STARTED'), 'WorkflowExecutionStarted')
  assert.equal(eventTypeName('EVENT_TYPE_START_CHILD_WORKFLOW_EXECUTION_INITIATED'), 'StartChildWorkflowExecutionInitiated')
  assert.equal(eventTypeName('ActivityTaskScheduled'), 'ActivityTaskScheduled')
})

test('base64 decoded size', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'x'.repeat(1000)]) assert.equal(b64Bytes(btoa(s)), s.length)
})

test('accepts all wrappers, jsonl, and reports malformed input', () => {
  const events = [ev(1, 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED', { workflowType: { name: 'W' } })]
  assert.equal(parseHistory(JSON.stringify({ events })).length, 1)
  assert.equal(parseHistory(JSON.stringify({ history: { events } })).length, 1)
  assert.equal(parseHistory(JSON.stringify(events)).length, 1)
  assert.equal(parseHistory(events.map(e => JSON.stringify(e)).join('\n')).length, 1)
  assert.throws(() => parseHistory('{"events": ['), /Not valid JSON/)
  assert.throws(() => parseHistory('{"foo": 1}'), /Expected a history/)
  assert.throws(() => parseHistory('{"events": [{"eventId": "1"}]}'), /eventType/)
  assert.throws(() => parseHistory(''), /empty/)
})

test('counts billable actions per the Temporal Cloud definitions', () => {
  const T = 'EVENT_TYPE_'
  const h = [
    ev(1, T + 'WORKFLOW_EXECUTION_STARTED', { workflowType: { name: 'W' }, input: p('"hello"') }),
    ev(2, T + 'WORKFLOW_EXECUTION_SIGNALED', { signalName: 'go', input: p('{}') }), // signal-with-start
    ev(3, T + 'WORKFLOW_TASK_COMPLETED', {}),
    ev(4, T + 'ACTIVITY_TASK_SCHEDULED', { activityType: { name: 'Pay' }, workflowTaskCompletedEventId: '3' }),
    ev(5, T + 'ACTIVITY_TASK_STARTED', { scheduledEventId: '4', attempt: 3 }),
    ev(6, T + 'ACTIVITY_TASK_COMPLETED', { scheduledEventId: '4', result: p('"x".repeat(10)') }),
    ev(7, T + 'TIMER_STARTED', { timerId: '1' }),
    ev(8, T + 'MARKER_RECORDED', { markerName: 'LocalActivity', workflowTaskCompletedEventId: '3' }),
    ev(9, T + 'MARKER_RECORDED', { markerName: 'LocalActivity', workflowTaskCompletedEventId: '3' }),
    ev(10, T + 'START_CHILD_WORKFLOW_EXECUTION_INITIATED', { workflowType: { name: 'C' } }),
    ev(11, T + 'UPSERT_WORKFLOW_SEARCH_ATTRIBUTES', { searchAttributes: { indexedFields: { TemporalChangeVersion: {} } } }),
    ev(12, T + 'UPSERT_WORKFLOW_SEARCH_ATTRIBUTES', { searchAttributes: { indexedFields: { CustomerId: {} } } }),
    ev(13, T + 'WORKFLOW_EXECUTION_SIGNALED', { signalName: 'go' }),
    ev(14, T + 'WORKFLOW_EXECUTION_COMPLETED', {}),
  ]
  const a = analyze(parseHistory(JSON.stringify({ events: h })))
  const by = Object.fromEntries(a.actions.map(r => [r.kind, r.count]))
  assert.equal(by['Workflow started'], 1)
  assert.equal(by['Activity started or retried'], 3)
  assert.equal(by['Timer started'], 1)
  assert.equal(by['Markers (local activities, side effects, versions)'], 1)
  assert.equal(by['Child workflow started'], 2)
  assert.equal(by['Search attributes upserted'], 1)
  assert.equal(by['Signal received'], 1)
  assert.equal(by['Signal-With-Start'], 0)
  assert.equal(a.totalActions, 10)
  assert.equal(a.status, 'Completed')
  assert.equal(a.activities[0].retries, 2)
  assert.equal(a.payloadBytes, 'json/plain'.length * 3 + 7 + 2 + 14)
  assert.equal(a.payloads[0].source, 'Activity · Pay')
  assert.equal(a.payloads[0].field, 'result')
})

test('child workflow start is billed to the parent', () => {
  const a = analyze(parseHistory(JSON.stringify([ev(1, 'WorkflowExecutionStarted', { parentWorkflowExecution: { workflowId: 'p' } })])))
  assert.equal(a.totalActions, 0)
})

test('samples parse and trigger the expected findings', () => {
  const healthy = analyze(parseHistory(healthySample()))
  assert.equal(healthy.status, 'Completed')
  assert.equal(healthy.recs[0].title, 'No issues found')

  const entity = analyze(parseHistory(entitySample()))
  assert.equal(entity.status, 'Running')
  assert.ok(entity.historyBytesReported)
  assert.ok(entity.eventCount > 8000 && entity.eventCount < 10_240)
  const titles = entity.recs.map(r => r.title)
  for (const t of ['Use Continue-As-New to bound history growth', 'Offload large payloads (claim-check / External Storage)', 'Batch signals', 'Reduce heartbeat frequency', 'Run short activities as Local Activities'])
    assert.ok(titles.includes(t), t)
  const pr = project(entity)!
  assert.ok(pr.daysTo.eventsWarn! > 0 && pr.daysTo.eventsWarn! < 10)

  const storm = analyze(parseHistory(retryStormSample()))
  assert.equal(storm.status, 'Failed')
  const charge = storm.activities.find(s => s.type === 'ChargeCard')!
  assert.equal(charge.retries, 61)
  assert.ok(charge.unlimitedRetries)
  assert.equal(storm.recs[0].severity, 'bad')
  assert.ok(storm.recs.some(r => r.title === 'Investigate Workflow Task failures'))
})
