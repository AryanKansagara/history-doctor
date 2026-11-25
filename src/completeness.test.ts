import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyze, assessCompleteness, NO_ISSUES, NO_ISSUES_SO_FAR, parseHistory, project } from './analyze.ts'
import { entitySample, healthySample, retryStormSample } from './samples.ts'

// Partial histories (https://github.com/AryanKansagara/history-doctor/issues/2): a history with events missing must
// never be called healthy and its Actions and cost are lower bounds, while a run that is merely still open (contiguous
// from event 1, nothing after) is a different thing: nothing is missing, the figures just grow.

const fixtureText = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const real = JSON.parse(fixtureText('py-signals-timers-updates.json')) as { events: Record<string, any>[] } // ids 1-23, started ... completed
const run = (events: object[], extra: object = {}, name = 'h') => analyze(parseHistory(JSON.stringify({ events, ...extra })), name)
const first = (a: ReturnType<typeof analyze>) => a.recs[0]

const CUTOFF = real.events.slice(0, 12)
const TAIL = real.events.slice(10)
const GAP = [...real.events.slice(0, 8), ...real.events.slice(16)]

test('the complete real history is complete, healthy, and counts 6 Actions', () => {
  const a = run(real.events)
  assert.equal(a.completeness.state, 'complete')
  assert.deepEqual(a.completeness.reasons, [])
  assert.equal(a.totalActions, 6)
  assert.equal(first(a).title, NO_ISSUES)
  assert.match(first(a).detail, /comfortably within limits/)
})

test('a run cut off mid-way with nothing after it is running so far, not missing events', () => {
  const a = run(CUTOFF)
  assert.equal(a.status, 'Running')
  assert.equal(a.completeness.state, 'running')
  assert.equal(a.eventCount, 12)
  assert.equal(a.totalActions, 5)
  assert.equal(first(a).title, NO_ISSUES_SO_FAR)
  assert.doesNotMatch(first(a).detail, /comfortably/)
  assert.match(first(a).detail, /still open/)
  assert.match(first(a).detail, /cut off/) // the ambiguity is stated, not hidden
})

test('only the start event is a running workflow so far', () => {
  assert.equal(run(real.events.slice(0, 1)).completeness.state, 'running')
})

test('a nextPageToken marks the export as one page of a longer history', () => {
  const a = run(CUTOFF, { nextPageToken: 'CgMxMjM=' })
  assert.equal(a.completeness.state, 'partial')
  assert.match(a.completeness.reasons[0], /nextPageToken/)
  assert.match(first(a).title, /^Partial history/)
  assert.ok(!a.recs.some(r => r.title === NO_ISSUES || r.title === NO_ISSUES_SO_FAR))
  assert.ok(!a.recs.some(r => /comfortably within limits/.test(r.detail)))
  assert.match(first(a).detail, /lower bounds/)
})

test('the page token is read from a wrapped response and in snake_case, and an empty token means the last page', () => {
  const wrapped = parseHistory(JSON.stringify({ history: { events: CUTOFF }, nextPageToken: 'abc' }))
  assert.equal(analyze(wrapped).completeness.state, 'partial')
  assert.equal(analyze(parseHistory(JSON.stringify({ events: CUTOFF, next_page_token: 'abc' }))).completeness.state, 'partial')
  for (const empty of ['""', 'null']) {
    const a = analyze(parseHistory(`{"events": ${JSON.stringify(real.events)}, "nextPageToken": ${empty}}`))
    assert.equal(a.completeness.state, 'complete', `nextPageToken ${empty}`)
  }
})

test('a token on a page that ends with a closing event is still partial (the closing event may not be the last)', () => {
  assert.equal(run(real.events, { nextPageToken: 'x' }).completeness.state, 'partial')
})

test('a history that starts after event 1 has leading events missing', () => {
  const a = run(TAIL)
  assert.equal(a.completeness.state, 'partial')
  assert.match(a.completeness.reasons.join(' '), /starts at event 11.*events 1-10 are missing/)
  assert.equal(a.status, 'Completed') // the status shown is that of the last event; the warning says what is missing
  assert.equal(a.totalActions, 2)
  assert.match(first(a).title, /^Partial history/)
  assert.equal(project(a), null)
})

test('one leading event missing is worded in the singular', () => {
  assert.match(run(real.events.slice(1)).completeness.reasons[0], /starts at event 2, so event 1 is missing/)
})

test('events missing in the middle are named', () => {
  const a = run(GAP)
  assert.equal(a.completeness.state, 'partial')
  assert.equal(a.completeness.reasons.length, 1)
  assert.match(a.completeness.reasons[0], /not contiguous \(missing: 9-16\)/)
  assert.equal(a.totalActions, 4) // the full file has 6; this stays a lower bound
  assert.ok(a.totalActions < run(real.events).totalActions)
  assert.match(first(a).title, /^Partial history/)
})

test('a single missing event and several gaps are listed, long lists are cut', () => {
  const ids = (keep: number[]) => real.events.filter(e => keep.includes(Number(e.eventId)))
  assert.match(run(ids([1, 2, 4, 5, 6, 8, 9, 10])).completeness.reasons[0], /missing: 3, 7\)/)
  const many = run(real.events.filter(e => Number(e.eventId) % 2 === 1))
  assert.match(many.completeness.reasons[0], /missing: 2, 4, 6, 8 and 7 more gap\(s\)/)
})

test('a first event that is not WorkflowExecutionStarted is not a whole history even when numbered from 1', () => {
  const a = run([{ ...real.events[1], eventId: '1' }, ...real.events.slice(2).map((e, i) => ({ ...e, eventId: String(i + 2) }))])
  assert.equal(a.completeness.state, 'partial')
  assert.match(a.completeness.reasons[0], /first event is .*not WorkflowExecutionStarted/)
})

test('duplicated, out-of-order, zero or non-numeric ids cannot be ruled out as missing events', () => {
  const dup = [real.events[0], real.events[1], real.events[1], real.events[2]]
  assert.equal(run(dup).completeness.state, 'partial')
  const swapped = [real.events[0], real.events[2], real.events[1], real.events[3]]
  assert.equal(run(swapped).completeness.state, 'partial')
  const zero = real.events.map((e, i) => ({ ...e, eventId: String(i) }))
  assert.equal(run(zero).completeness.state, 'partial')
  const text = real.events.map((e, i) => (i === 3 ? { ...e, eventId: 'four' } : e))
  assert.equal(run(text).completeness.state, 'partial')
  const lone = [{ ...real.events[0], eventId: 'x' }]
  assert.equal(run(lone).completeness.state, 'partial')
  for (const events of [dup, swapped, zero, text, lone]) {
    const a = run(events)
    assert.match(a.completeness.reasons.join(' '), /duplicated, out of order or not numbers/)
    assert.ok(!a.recs.some(r => r.title.startsWith('No issues found')))
  }
})

test('several problems at once are all reported', () => {
  const a = run(TAIL.filter(e => Number(e.eventId) !== 15), { nextPageToken: 'x' })
  assert.equal(a.completeness.reasons.length, 3)
})

test('events without eventId are numbered by position and stay complete', () => {
  const noIds = real.events.map(({ eventId, ...e }) => e)
  const a = run(noIds)
  assert.equal(a.completeness.state, 'complete')
  assert.equal(a.totalActions, 6)
})

test('an unfinished JSONL export carries no page token and is judged by its events', () => {
  const lines = (evs: object[]) => evs.map(e => JSON.stringify(e)).join('\n')
  assert.equal(analyze(parseHistory(lines(CUTOFF))).completeness.state, 'running')
  assert.equal(analyze(parseHistory(lines(GAP))).completeness.state, 'partial')
  assert.equal(analyze(parseHistory(JSON.stringify(GAP))).completeness.state, 'partial') // bare array
})

test('a partial history keeps its other findings and puts the warning first', () => {
  const evs = parseHistory(entitySample())
  const whole = analyze(evs)
  const partial = analyze(evs.slice(5), 'entity-tail')
  assert.equal(partial.completeness.state, 'partial')
  assert.equal(partial.recs[0].title, 'Partial history: events are missing')
  assert.ok(partial.recs.length > 1)
  assert.ok(whole.recs.length > 1)
  assert.ok(partial.recs.every(r => r.title !== NO_ISSUES))
})

test('every real SDK fixture and sample keeps its numbers and is not flagged as partial', () => {
  const expected: Record<string, [events: number, actions: number, state: string]> = {
    'java-async-activity-retry.json': [11, 3, 'complete'],
    'java-cancel-nexus-operation.json': [15, 3, 'complete'],
    'py-signals-timers-updates.json': [23, 6, 'complete'],
    'py-swallowed-activity-cancellation.json': [48, 8, 'running'],
    'ts-random-replay-1.17.2.json': [65, 15, 'complete'],
  }
  for (const [f, [events, actions, state]] of Object.entries(expected)) {
    const a = analyze(parseHistory(fixtureText(f)), f)
    assert.equal(a.eventCount, events, f)
    assert.equal(a.totalActions, actions, f)
    assert.equal(a.completeness.state, state, f)
    assert.ok(!a.recs.some(r => r.title.startsWith('Partial history')), f)
  }
  assert.equal(analyze(parseHistory(fixtureText('py-signals-timers-updates.json'))).totalActions, 6)
  assert.equal(analyze(parseHistory(healthySample())).totalActions, 8)
  assert.equal(analyze(parseHistory(entitySample())).totalActions, 1893)
  assert.equal(analyze(parseHistory(retryStormSample())).totalActions, 78)
  assert.equal(analyze(parseHistory(healthySample())).completeness.state, 'complete')
  assert.equal(analyze(parseHistory(entitySample())).completeness.state, 'running')
  assert.equal(analyze(parseHistory(retryStormSample())).completeness.state, 'complete')
})

test('assessCompleteness works on bare events', () => {
  const ev = (id: number, type: string) => ({ id, type, time: id, attrs: {}, bytes: 1 })
  assert.equal(assessCompleteness([ev(1, 'WorkflowExecutionStarted')]).state, 'running')
  assert.equal(assessCompleteness([ev(1, 'WorkflowExecutionStarted'), ev(2, 'WorkflowExecutionContinuedAsNew')]).state, 'complete')
  assert.equal(assessCompleteness([ev(1, 'WorkflowExecutionStarted'), ev(3, 'WorkflowExecutionCompleted')]).state, 'partial')
})
