import { expect, test, fileInput, finding, fixtureJson, HEALTHY_VERDICT, openTab, stat, upload } from './support.ts'

// Incomplete histories (https://github.com/AryanKansagara/history-doctor/issues/2) must never get the healthy
// "No issues found / comfortably within limits" verdict, and non-Temporal JSON
// (https://github.com/AryanKansagara/history-doctor/issues/3) must be rejected rather than analysed.
// A known app bug is declared with test.fail(): it passes while the bug exists and starts failing the moment it is
// fixed, at which point the `.fail` must be turned into a normal `test`. The control test below proves the page
// objects used here are right, so an expected failure cannot hide behind a broken selector.

const real = fixtureJson('py-signals-timers-updates.json') // 23 events, ids 1-23, started ... completed
type Events = Record<string, unknown>[]
const json = (events: Events, extra: object = {}) => JSON.stringify({ events, ...extra })

// Events are missing: the page must say so, give no verdict and show lower bounds.
const MISSING: { name: string; text: string; events: string; actions: string; reason: RegExp }[] = [
  { name: 'first page of a paginated export (nextPageToken set)', text: json(real.events.slice(0, 12), { nextPageToken: 'CgMxMjM=' }), events: '12', actions: '5', reason: /nextPageToken/ },
  { name: 'first events missing (events 11-23)', text: json(real.events.slice(10)), events: '13', actions: '2', reason: /starts at event 11.*events 1-10 are missing/ },
  { name: 'events missing in the middle (9-16 removed)', text: json([...real.events.slice(0, 8), ...real.events.slice(16)]), events: '15', actions: '4', reason: /missing: 9-16/ },
]

// Contiguous from event 1 with nothing after: a workflow that is still running. Nothing is missing, but it is not final.
const RUNNING: { name: string; text: string; events: string; actions: string }[] = [
  { name: 'cut off or still running (events 1-12)', text: json(real.events.slice(0, 12)), events: '12', actions: '5' },
  { name: 'only the start event', text: json(real.events.slice(0, 1)), events: '1', actions: '1' },
]

test.beforeEach(async ({ page }) => {
  await page.goto('/app')
})

test('control: the complete history of the same run gets the healthy verdict (6 Actions)', async ({ page }) => {
  await upload(page, { name: 'complete.json', text: json(real.events) })
  await expect(stat(page, 'Events')).toContainText('23')
  await expect(stat(page, 'Billable Actions')).toContainText('6')
  await expect(page.getByText(HEALTHY_VERDICT).first()).toBeVisible()
})

test('compare view marks a partial history and its cost as a lower bound, and leaves the complete one alone', async ({ page }) => {
  await fileInput(page).setInputFiles([
    { name: 'whole.json', mimeType: 'application/json', buffer: Buffer.from(json(real.events)) },
    { name: 'gap.json', mimeType: 'application/json', buffer: Buffer.from(json([...real.events.slice(0, 8), ...real.events.slice(16)])) },
  ])
  const row = (name: string) => page.locator('tr.clickable').filter({ hasText: name })
  await expect(page.getByRole('heading', { name: /Comparing 2 histories/ })).toBeVisible()
  await expect(row('gap.json')).toContainText('Partial')
  await expect(row('gap.json')).toContainText('≥ 4')
  await expect(row('gap.json')).toContainText('Partial history: events are missing')
  await expect(row('whole.json')).not.toContainText('Partial')
  await expect(row('whole.json')).not.toContainText('≥')
  await expect(row('whole.json')).toContainText('No issues found')
  await expect(page.locator('tfoot')).toContainText('≥')
})

for (const c of MISSING) {
  test(`partial history is flagged, not declared healthy, and priced as a lower bound: ${c.name}`, async ({ page }) => {
    await upload(page, { name: 'partial.json', text: c.text })
    // The overview still renders the numbers it has...
    await expect(stat(page, 'Events')).toContainText(c.events)
    await expect(stat(page, 'Billable Actions')).toContainText(`≥ ${c.actions}`)
    await expect(stat(page, 'Billable Actions')).toContainText('lower bound')
    await expect(stat(page, 'Cost')).toContainText('≥ $')
    // ...but say they are partial and why,
    await expect(page.getByRole('heading', { level: 2 })).toContainText('Partial history')
    await expect(page.locator('.partial-note')).toContainText('events are missing')
    await expect(page.locator('.partial-note')).toContainText(c.reason)
    await expect(finding(page, 'Partial history: events are missing')).toBeVisible()
    await expect(page.getByRole('tab', { name: /Recommendations/ })).toContainText('1')
    // and a snapshot that may be missing the part that breaks limits is not "within limits".
    await expect(page.getByText(HEALTHY_VERDICT)).toHaveCount(0)
    await expect(page.getByText(/within limits/)).toHaveCount(0)

    await openTab(page, 'Actions & cost')
    await expect(stat(page, 'Cost per run')).toContainText('≥ $')
    await expect(stat(page, 'Actions per run')).toContainText(`≥ ${c.actions}`)
    await expect(stat(page, 'Monthly with volume tiers')).toContainText('≥ $')
    await openTab(page, 'Limits')
    await expect(page.getByText('Growth is not extrapolated')).toBeVisible()
  })
}

for (const c of RUNNING) {
  test(`a run that is contiguous from event 1 and still open is running so far, not missing events: ${c.name}`, async ({ page }) => {
    await upload(page, { name: 'running.json', text: c.text })
    await expect(stat(page, 'Events')).toContainText(c.events)
    await expect(stat(page, 'Billable Actions')).toContainText(c.actions)
    await expect(stat(page, 'Billable Actions')).not.toContainText('≥')
    await expect(page.getByRole('heading', { level: 2 })).toContainText('Running')
    await expect(page.getByRole('heading', { level: 2 })).not.toContainText('Partial history')
    await expect(page.locator('.partial-note')).toHaveCount(0)
    // It is labelled as not final, and never gets the "comfortably within limits" verdict a closed run gets.
    await expect(stat(page, 'Cost so far')).toContainText('run still open')
    await expect(finding(page, 'No issues found so far')).toBeVisible()
    await expect(page.getByText(/still open/).first()).toBeVisible()
    await expect(page.getByText(/comfortably within limits/)).toHaveCount(0)
    await expect(finding(page, 'Partial history')).toHaveCount(0)
  })
}

test.fail('non-Temporal events (eventType + eventTime only) are not declared healthy', async ({ page }) => {
  await upload(page, { name: 'clicks.json', text: '[{"eventType":"click","eventTime":"2026-01-01T00:00:00Z"},{"eventType":"scroll","eventTime":"2026-01-01T00:00:05Z"}]' })
  await expect(page.locator('.finding.bad')).toContainText('does not look like a Temporal Event History')
  await expect(page.locator('.stat')).toHaveCount(0)
  await expect(page.getByText(HEALTHY_VERDICT)).toHaveCount(0)
})
