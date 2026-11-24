import { expect, test, actionCount, finding, openTab, sampleButton, stat } from './support.ts'

// Expected numbers are counted by hand from the generator in src/samples.ts and the Temporal Cloud "What is an Action?" rules
// (workflow start, each activity attempt, timer, received signal, search-attribute upsert, ... = 1 Action each).

test.beforeEach(async ({ page }) => {
  await page.goto('/app')
})

test('healthy sample: 41 events, 8 Actions, no findings', async ({ page }) => {
  await sampleButton(page, 'Healthy order fulfillment').click()
  await expect(page.getByRole('heading', { name: /OrderFulfillmentWorkflow/ })).toContainText('Completed')
  // 1 start + 3 workflow tasks x 7 + 5 activities x 3 + timer, signal, timer-cancel, completion = 41
  await expect(stat(page, 'Events')).toContainText('41')
  await expect(stat(page, 'Events')).toContainText('<0.1% of hard limit')
  await expect(stat(page, 'Events')).toContainText('warn 10.2K')
  await expect(stat(page, 'Events')).toContainText('limit 51.2K')
  await expect(stat(page, 'History size')).toContainText('limit 50 MB')
  // 1 start + 5 activity attempts + 1 timer + 1 signal = 8 Actions, 8 / 1M x $50 = $0.0004
  await expect(stat(page, 'Billable Actions')).toContainText('8')
  await expect(stat(page, 'Cost of this run')).toContainText('$0.00040')
  await expect(page.getByText('No issues found').first()).toBeVisible()
  await expect(page.getByText(/comfortably within limits/)).toBeVisible()

  await openTab(page, 'Actions & cost')
  await expect(actionCount(page, 'Activity started or retried')).toHaveText('5')
  await expect(actionCount(page, 'Timer started')).toHaveText('1')
  await expect(actionCount(page, 'Signal received')).toHaveText('1')
  await expect(actionCount(page, 'Workflow started')).toHaveText('1')
})

test('subscription entity sample: near the event and size limits, Continue-As-New advised', async ({ page }) => {
  await sampleButton(page, 'Subscription entity near limits').click()
  await expect(page.getByRole('heading', { name: /SubscriptionWorkflow/ })).toContainText('Running')
  // 1 start + 3 + 41 days x 231 + 6 (invoice export) + 5 search-attribute upserts = 9,486
  await expect(stat(page, 'Events')).toContainText('9,486')
  await expect(stat(page, 'History size')).toContainText('server-reported')
  await expect(stat(page, 'History size')).toContainText('9.34 MB')
  await expect(stat(page, 'Payload bytes')).toContainText('largest 1.68 MB')
  // 1 start + 41 x (1 timer + 22 signals + 22 RecordUsage + 1 SyncEntitlements) + 1 export + 5 upserts = 1,893
  await expect(stat(page, 'Billable Actions')).toContainText('1,893')

  for (const title of [
    'Use Continue-As-New to bound history growth',
    'Offload large payloads (claim-check / External Storage)',
    'Batch signals',
    'Reduce heartbeat frequency',
    'Run short activities as Local Activities',
  ]) await expect(finding(page, title)).toBeVisible()
  await expect(page.getByText('No issues found')).toHaveCount(0)

  await openTab(page, 'Limits')
  const warn = page.locator('tr', { hasText: 'Events: warning' })
  await expect(warn).toContainText('9,486')
  await expect(warn).toContainText('10,240')
  await expect(page.locator('tr', { hasText: 'Events: hard limit' })).toContainText('51,200')
  await expect(page.locator('tr', { hasText: 'Signals received' })).toContainText('10,000')
})

test('payment retry storm sample: 72 retries, failed workflow, workflow task failure', async ({ page }) => {
  await sampleButton(page, 'Payment retry storm').click()
  await expect(page.getByRole('heading', { name: /PaymentWorkflow/ })).toContainText('Failed')
  await expect(stat(page, 'Events')).toContainText('33')
  // 1 start + 4 FraudCheck + 62 ChargeCard + 9 ReleaseFundsHold + 1 NotifyCustomer attempts + 1 local-activity marker = 78
  await expect(stat(page, 'Billable Actions')).toContainText('78')
  await expect(finding(page, 'Tune the retry policy for ChargeCard')).toBeVisible()
  await expect(finding(page, 'Investigate Workflow Task failures')).toBeVisible()
  await expect(page.getByText('No issues found')).toHaveCount(0)

  await openTab(page, 'Retries & failures')
  const charge = page.locator('tr', { has: page.locator('td:first-child', { hasText: /^ChargeCard/ }) })
  await expect(charge).toContainText('retry storm')
  await expect(charge.locator('td').nth(2)).toHaveText('62') // attempts
  await expect(charge.locator('td').nth(3)).toHaveText('61') // retries
  await expect(page.locator('.finding', { hasText: 'WORKFLOW_WORKER_UNHANDLED_FAILURE' })).toContainText('× 1')
})

test('real SDK samples load with the counts the unit tests pin', async ({ page }) => {
  await sampleButton(page, 'Real: TypeScript SDK test run').click()
  await expect(page.getByRole('heading', { name: /directRandomAndUuidResetWorkflow/ })).toContainText('Completed')
  await expect(stat(page, 'Events')).toContainText('65')
  await expect(stat(page, 'Billable Actions')).toContainText('15')

  await page.reload()
  await sampleButton(page, 'Real: Python SDK test run').click()
  await expect(stat(page, 'Events')).toContainText('23')
  await expect(stat(page, 'Billable Actions')).toContainText('6')
})

test('loading all samples shows a comparison with totals', async ({ page }) => {
  for (const label of ['Healthy order fulfillment', 'Subscription entity near limits', 'Payment retry storm'])
    await sampleButton(page, label).click()
  await expect(page.getByRole('heading', { name: 'Comparing 3 histories' })).toBeVisible()
  const total = page.locator('tfoot tr')
  // 41 + 9,486 + 33 events; 8 + 1,893 + 78 Actions
  await expect(total).toContainText('9,560')
  await expect(total).toContainText('1,979')
  // Clicking a row switches the inspected history.
  await page.locator('tbody tr', { hasText: 'payment-retry-storm.json' }).click()
  await expect(page.getByRole('heading', { name: /PaymentWorkflow/ })).toBeVisible()
})
