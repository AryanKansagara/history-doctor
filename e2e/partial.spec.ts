import { expect, test, fixtureJson, HEALTHY_VERDICT, stat, upload } from './support.ts'

// A history that is visibly incomplete must never get the healthy "No issues found / comfortably within limits"
// verdict. The app does not do this yet: https://github.com/AryanKansagara/history-doctor/issues/2
// https://github.com/AryanKansagara/history-doctor/issues/3 covers non-Temporal JSON.
// Those cases are declared with test.fail(): they pass while the bug exists and start failing the moment it is fixed,
// at which point the `.fail` must be turned into a normal `test`. The control test below proves the page objects used
// here are right, so an expected failure cannot hide behind a broken selector.

const real = fixtureJson('py-signals-timers-updates.json') // 23 events, ids 1-23, started ... completed
type Events = Record<string, unknown>[]
const json = (events: Events, extra: object = {}) => JSON.stringify({ events, ...extra })

const PARTIAL: { name: string; text: string; events: string; actions: string }[] = [
  { name: 'cut off mid-run (events 1-12)', text: json(real.events.slice(0, 12)), events: '12', actions: '5' },
  { name: 'first page of a paginated export (nextPageToken set)', text: json(real.events.slice(0, 12), { nextPageToken: 'CgMxMjM=' }), events: '12', actions: '5' },
  { name: 'first events missing (events 11-23)', text: json(real.events.slice(10)), events: '13', actions: '2' },
  { name: 'events missing in the middle (9-16 removed)', text: json([...real.events.slice(0, 8), ...real.events.slice(16)]), events: '15', actions: '4' },
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

for (const c of PARTIAL) {
  test.fail(`partial history is not declared healthy: ${c.name}`, async ({ page }) => {
    await upload(page, { name: 'partial.json', text: c.text })
    // The overview renders with the partial numbers...
    await expect(stat(page, 'Events')).toContainText(c.events)
    await expect(stat(page, 'Billable Actions')).toContainText(c.actions)
    // ...but a snapshot that may be missing the part that breaks limits cannot be "within limits".
    await expect(page.getByText(HEALTHY_VERDICT)).toHaveCount(0)
  })
}

test.fail('non-Temporal events (eventType + eventTime only) are not declared healthy', async ({ page }) => {
  await upload(page, { name: 'clicks.json', text: '[{"eventType":"click","eventTime":"2026-01-01T00:00:00Z"},{"eventType":"scroll","eventTime":"2026-01-01T00:00:05Z"}]' })
  await expect(page.locator('.finding.bad, .stat').first()).toBeVisible()
  await expect(page.getByText(HEALTHY_VERDICT)).toHaveCount(0)
})
