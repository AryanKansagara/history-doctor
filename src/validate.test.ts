import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { analyze, isKnownEventType, parseHistory } from './analyze.ts'
import { entitySample, healthySample, retryStormSample } from './samples.ts'

// Non-Temporal JSON (https://github.com/AryanKansagara/history-doctor/issues/3): anything that merely has `eventType`
// and `eventTime` must not be analysed as a Temporal history, while unknown *newer* Temporal event types must not be
// refused when the history is otherwise recognisable.

const NOT_TEMPORAL = /does not look like a Temporal Event History/
const fixtureText = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const real = JSON.parse(fixtureText('py-signals-timers-updates.json')) as { events: Record<string, any>[] }
const t0 = '2026-01-01T00:00:00Z'

test('the issue examples are rejected with a clear message', () => {
  const clicks = '[{"eventType":"click","eventTime":"2026-01-01T00:00:00Z"},{"eventType":"scroll","eventTime":"2026-01-01T00:00:05Z"}]'
  assert.throws(() => parseHistory(clicks), NOT_TEMPORAL)
  assert.throws(() => parseHistory(clicks), /event #1 has type "click"/)
  assert.throws(() => parseHistory('{"events":[{"eventId":"1","eventType":"EVENT_TYPE_FOO","eventTime":"2026-01-01T00:00:00Z"}]}'), NOT_TEMPORAL)
  assert.throws(() => parseHistory('{"events":[{"eventId":"1","eventType":"EVENT_TYPE_FOO","eventTime":"2026-01-01T00:00:00Z"}]}'), /"EVENT_TYPE_FOO"/)
})

test('other shapes of non-Temporal event data are rejected too', () => {
  const ev = (eventType: string, extra: object = {}) => ({ eventType, eventTime: t0, ...extra })
  const cases: Record<string, string> = {
    'single event object': JSON.stringify(ev('click')),
    'history wrapper': JSON.stringify({ history: { events: [ev('click')] } }),
    jsonl: [ev('click'), ev('scroll')].map(e => JSON.stringify(e)).join('\n'),
    'PascalCase names': JSON.stringify([ev('PageView'), ev('Purchase')]),
    'UPPER_SNAKE names without the Temporal prefix': JSON.stringify([ev('PAGE_VIEW'), ev('PURCHASE')]),
    'unknown names with attributes only': JSON.stringify([ev('Click', { clickEventAttributes: {} })]),
    'eventType with a Temporal-looking prefix only': JSON.stringify([ev('EVENT_TYPE_'), ev('event_type_x')]),
    'only the unspecified placeholder': JSON.stringify([ev('EVENT_TYPE_UNSPECIFIED')]),
    'many analytics events': JSON.stringify(Array.from({ length: 1000 }, (_, i) => ev(i % 2 ? 'click' : 'scroll', { eventId: String(i + 1) }))),
  }
  for (const [name, text] of Object.entries(cases)) assert.throws(() => parseHistory(text), NOT_TEMPORAL, name)
})

test('a history with one foreign event among Temporal events is rejected, naming the event', () => {
  const events = [...real.events.slice(0, 3), { eventId: '4', eventType: 'click', eventTime: t0 }, ...real.events.slice(4)]
  assert.throws(() => parseHistory(JSON.stringify({ events })), /event #4 has type "click"/)
})

test('unknown newer Temporal event types are accepted when the history is otherwise recognisable', () => {
  const future = (id: number, eventType: string, extra: object = {}) => ({ eventId: String(id), eventType, eventTime: real.events[21].eventTime, ...extra })
  // The closing event stays last, as it always is in a closed run; the unknown event sits just before it.
  const beforeEnd = (e: Record<string, any>) => [...real.events.slice(0, 22), e, { ...real.events[22], eventId: '24' }]
  const plain = analyze(parseHistory(JSON.stringify({ events: real.events })))
  const variants: Record<string, Record<string, any>[]> = {
    'proto-style name, attributes': beforeEnd(future(23, 'EVENT_TYPE_WORKFLOW_EXECUTION_FUTURE_THING', { workflowExecutionFutureThingEventAttributes: { reason: 'x' } })),
    'proto-style name, no attributes (an exporter that does not know the type)': beforeEnd(future(23, 'EVENT_TYPE_WORKFLOW_EXECUTION_FUTURE_THING')),
    'PascalCase name with attributes': beforeEnd(future(23, 'WorkflowExecutionFutureThing', { workflowExecutionFutureThingEventAttributes: {} })),
    'PascalCase name with an attributes object': beforeEnd(future(23, 'WorkflowExecutionFutureThing', { attributes: {} })),
    'as the second event': [real.events[0], future(2, 'EVENT_TYPE_FUTURE_THING'), ...real.events.slice(1).map(e => ({ ...e, eventId: String(Number(e.eventId) + 1) }))],
  }
  for (const [name, events] of Object.entries(variants)) {
    const a = analyze(parseHistory(JSON.stringify({ events })), name)
    assert.equal(a.eventCount, 24, name)
    assert.equal(a.totalActions, plain.totalActions, name) // nothing the app knows is counted differently
    assert.equal(a.workflowType, plain.workflowType, name)
    assert.equal(a.status, 'Completed', name)
  }
  const a = analyze(parseHistory(JSON.stringify({ events: variants['proto-style name, attributes'] })))
  assert.equal(a.timeline.length, 24) // the unknown event is still part of the timeline and the event count
})

test('a history made only of unknown types is not recognisable and is rejected', () => {
  const only = [{ eventId: '1', eventType: 'EVENT_TYPE_FUTURE_A', eventTime: t0, futureAEventAttributes: {} }, { eventId: '2', eventType: 'EVENT_TYPE_FUTURE_B', eventTime: t0 }]
  assert.throws(() => parseHistory(JSON.stringify(only)), NOT_TEMPORAL)
})

test('a single known event is enough, in either naming style and any leading case', () => {
  for (const eventType of ['EVENT_TYPE_WORKFLOW_EXECUTION_STARTED', 'WorkflowExecutionStarted', 'workflowExecutionStarted'])
    assert.equal(parseHistory(JSON.stringify([{ eventType, eventTime: t0 }])).length, 1, eventType)
  // And a partial history without a start event is still accepted (and flagged elsewhere), not refused as non-Temporal.
  assert.equal(parseHistory(JSON.stringify([{ eventId: '9', eventType: 'EVENT_TYPE_TIMER_FIRED', eventTime: t0 }])).length, 1)
})

test('every event type in the real SDK fixtures and the samples is a known Temporal type', () => {
  const types = new Set<string>()
  const add = (text: string) => { for (const e of parseHistory(text)) types.add(e.type) }
  for (const f of readdirSync(new URL('./fixtures/', import.meta.url))) add(fixtureText(f))
  for (const s of [healthySample(), entitySample(), retryStormSample()]) add(s)
  assert.ok(types.size > 15)
  for (const t of types) assert.ok(isKnownEventType(t), t)
})

test('the known list covers the Temporal EventType enum, without the placeholder', () => {
  for (const t of ['WorkflowExecutionStarted', 'WorkflowTaskScheduled', 'ActivityTaskCancelRequested', 'TimerFired', 'MarkerRecorded',
    'WorkflowExecutionUpdateAdmitted', 'WorkflowPropertiesModifiedExternally', 'NexusOperationCancelRequestFailed', 'WorkflowExecutionOptionsUpdated',
    'StartChildWorkflowExecutionInitiated', 'ExternalWorkflowExecutionSignaled', 'UpsertWorkflowSearchAttributes']) assert.ok(isKnownEventType(t), t)
  assert.ok(!isKnownEventType('Unspecified'))
  assert.ok(!isKnownEventType('Click'))
})

test('every real SDK fixture and sample parses to the same events and numbers as before', () => {
  const expected: Record<string, [events: number, actions: number]> = {
    'java-async-activity-retry.json': [11, 3], 'java-cancel-nexus-operation.json': [15, 3], 'py-signals-timers-updates.json': [23, 6],
    'py-swallowed-activity-cancellation.json': [48, 8], 'ts-random-replay-1.17.2.json': [65, 15],
  }
  for (const [f, [events, actions]] of Object.entries(expected)) {
    const a = analyze(parseHistory(fixtureText(f)), f)
    assert.deepEqual([a.eventCount, a.totalActions], [events, actions], f)
  }
  assert.deepEqual([healthySample, entitySample, retryStormSample].map(s => analyze(parseHistory(s())).totalActions), [8, 1893, 78])
})

test('the other input errors keep their messages and order', () => {
  assert.throws(() => parseHistory('[1,2,3]'), /Event #1 is not an object/)
  assert.throws(() => parseHistory('{"events":[{"eventId":"1"}]}'), /eventType/)
  assert.throws(() => parseHistory('{"events":[{"eventId":"1","eventType":"EVENT_TYPE_WORKFLOW_EXECUTION_STARTED","eventTime":"yesterday"}]}'), /eventTime/)
  assert.throws(() => parseHistory('{"events":[{"eventId":"1","eventType":"click","eventTime":"yesterday"}]}'), /eventTime/)
  assert.throws(() => parseHistory('[]'), /no events/)
  assert.throws(() => parseHistory('{"foo":1}'), /Expected a history/)
  assert.throws(() => parseHistory('<html>'), /Not valid JSON/)
  assert.throws(() => parseHistory(''), /empty/)
})
