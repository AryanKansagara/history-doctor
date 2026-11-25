import { expect, test, fixtureJson, fileInput, HEALTHY_VERDICT, stat, upload } from './support.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/app')
})

const valid = JSON.stringify(fixtureJson('py-signals-timers-updates.json'))

const BAD: { name: string; text: string; message: RegExp }[] = [
  { name: 'plain text', text: 'hello world', message: /Not valid JSON/ },
  { name: 'HTML', text: '<html><body>nope</body></html>', message: /Not valid JSON/ },
  { name: 'empty file', text: '', message: /Input is empty/ },
  { name: 'whitespace only', text: ' \n\t ', message: /Input is empty/ },
  { name: 'truncated JSON', text: valid.slice(0, Math.floor(valid.length / 2)), message: /Not valid JSON/ },
  { name: 'truncated JSONL (last line cut)', text: '{"eventId":"1","eventType":"EVENT_TYPE_WORKFLOW_EXECUTION_STARTED","eventTime":"2026-01-01T00:00:00Z"}\n{"eventId":"2","eventTyp', message: /Not valid JSON/ },
  { name: 'JSON number', text: '123', message: /Expected a history/ },
  { name: 'JSON null', text: 'null', message: /Expected a history/ },
  { name: 'JSON string', text: '"abc"', message: /Expected a history/ },
  { name: 'unrelated object', text: '{"foo":1}', message: /Expected a history/ },
  { name: 'unrelated nested object', text: '{"users":[{"id":1,"name":"a"}]}', message: /Expected a history/ },
  { name: 'empty array', text: '[]', message: /History contains no events/ },
  { name: 'empty events', text: '{"events":[]}', message: /History contains no events/ },
  { name: 'array of numbers', text: '[1,2,3]', message: /Event #1 is not an object/ },
  { name: 'event without eventType', text: '{"events":[{"eventId":"1"}]}', message: /eventType/ },
  { name: 'analytics events with eventType and eventTime', text: '[{"eventType":"click","eventTime":"2026-01-01T00:00:00Z"},{"eventType":"scroll","eventTime":"2026-01-01T00:00:05Z"}]', message: /does not look like a Temporal Event History.*event #1 has type "click"/ },
  { name: 'analytics events wrapped in {"events": [...]}', text: '{"events":[{"eventType":"purchase","eventTime":"2026-01-01T00:00:00Z"}]}', message: /does not look like a Temporal Event History/ },
  { name: 'an event type that is not in Temporal\'s EventType enum', text: '{"events":[{"eventId":"1","eventType":"EVENT_TYPE_FOO","eventTime":"2026-01-01T00:00:00Z"}]}', message: /does not look like a Temporal Event History.*"EVENT_TYPE_FOO"/ },
  { name: 'a Temporal history with a foreign event in it', text: JSON.stringify({ events: [...fixtureJson('py-signals-timers-updates.json').events.slice(0, 3), { eventId: '4', eventType: 'click', eventTime: '2026-01-01T00:00:00Z' }] }), message: /does not look like a Temporal Event History.*event #4 has type "click"/ },
  { name: 'event without a valid time', text: '{"events":[{"eventId":"1","eventType":"EVENT_TYPE_WORKFLOW_EXECUTION_STARTED","eventTime":"yesterday"}]}', message: /eventTime/ },
]

for (const c of BAD) {
  test(`uploading ${c.name} shows a message and no results`, async ({ page }) => {
    await upload(page, { name: 'bad.json', text: c.text })
    const error = page.locator('.finding.bad')
    await expect(error).toContainText('bad.json:')
    await expect(error).toContainText(c.message)
    await expect(page.locator('.chip.err')).toHaveCount(1)
    // No overview, no tabs, no verdict of any kind.
    await expect(page.locator('.stat')).toHaveCount(0)
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByText(HEALTHY_VERDICT)).toHaveCount(0)
  })
}

test('pasting invalid JSON reports it under "Pasted JSON"; fixing it shows results', async ({ page }) => {
  const box = page.getByPlaceholder(/"events"/)
  await box.fill('{"events": [')
  await expect(page.locator('.finding.bad')).toContainText('Pasted JSON:')
  await expect(page.locator('.finding.bad')).toContainText('Not valid JSON')
  await expect(page.locator('.stat')).toHaveCount(0)
  await box.fill(valid)
  await expect(page.locator('.finding.bad')).toHaveCount(0)
  await expect(stat(page, 'Events')).toContainText('23')
})

test('a bad file next to a good one reports the bad one and still analyses the good one', async ({ page }) => {
  await fileInput(page).setInputFiles([
    { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"events": [') },
    { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(valid) },
  ])
  await expect(page.locator('.finding.bad')).toContainText('broken.json:')
  await expect(stat(page, 'Events')).toContainText('23')
  await expect(page.getByRole('heading', { name: /Comparing/ })).toHaveCount(0) // only one analysable history
})

test('an event type newer than this tool knows does not stop a recognisable history from being analysed', async ({ page }) => {
  const events = fixtureJson('py-signals-timers-updates.json').events
  const future = { eventId: '23', eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_FUTURE_THING', eventTime: events[21].eventTime, workflowExecutionFutureThingEventAttributes: { reason: 'x' } }
  // Just before the closing event, which stays last.
  await upload(page, { name: 'future.json', text: JSON.stringify({ events: [...events.slice(0, 22), future, { ...events[22], eventId: '24' }] }) })
  await expect(page.locator('.finding.bad')).toHaveCount(0)
  await expect(stat(page, 'Events')).toContainText('24')
  await expect(stat(page, 'Billable Actions')).toContainText('6') // the future event adds nothing the tool can count
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Completed')
})
