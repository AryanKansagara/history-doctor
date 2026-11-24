import { expect, test, actionCount, fileInput, fixtureJson, fixturePath, openTab, stat, upload } from './support.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/app')
})

// Counted by hand from the event lists of the unmodified SDK replay histories in src/fixtures.

test('Python SDK replay: signals, update, activity and timer = 6 Actions', async ({ page }) => {
  await upload(page, 'py-signals-timers-updates.json')
  await expect(page.getByRole('heading', { name: /SignalsActivitiesTimersUpdatesTracingWorkflow/ })).toContainText('Completed')
  await expect(stat(page, 'Events')).toContainText('23')
  await expect(stat(page, 'Billable Actions')).toContainText('6')
  await openTab(page, 'Actions & cost')
  // events 3-4 are signals but not signal-with-start; 1 update accepted; 1 activity attempt; 1 timer; 1 start
  await expect(actionCount(page, 'Signal received')).toHaveText('2')
  await expect(actionCount(page, 'Update accepted')).toHaveText('1')
  await expect(actionCount(page, 'Activity started or retried')).toHaveText('1')
  await expect(actionCount(page, 'Timer started')).toHaveText('1')
  await expect(actionCount(page, 'Workflow started')).toHaveText('1')
})

test('TypeScript SDK replay: four children, four timers and an operator reset = 15 Actions', async ({ page }) => {
  await upload(page, 'ts-random-replay-1.17.2.json')
  await expect(stat(page, 'Events')).toContainText('65')
  await expect(stat(page, 'Billable Actions')).toContainText('15')
  await openTab(page, 'Actions & cost')
  await expect(actionCount(page, 'Child workflow started')).toHaveText('8') // 4 x 2 Actions
  await expect(actionCount(page, 'Timer started')).toHaveText('4')
  await expect(actionCount(page, 'Workflow reset')).toHaveText('1')
  await expect(actionCount(page, 'Signal received')).toHaveText('1')
  await expect(actionCount(page, 'Workflow started')).toHaveText('1')
  // The reset is an operator action, not a workflow-task failure.
  await openTab(page, 'Retries & failures')
  await expect(page.getByText('reset 1 time(s)')).toBeVisible()
  await expect(page.getByText('None.')).toBeVisible()
})

test('Java SDK replay: one failed activity attempt, workflow failed', async ({ page }) => {
  await upload(page, 'java-async-activity-retry.json')
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Failed')
  await expect(stat(page, 'Events')).toContainText('11')
  // 1 start + 2 attempts of the activity (attempt number 2 on the started event)
  await expect(stat(page, 'Billable Actions')).toContainText('3')
  await openTab(page, 'Retries & failures')
  const row = page.locator('tbody tr').first()
  await expect(row.locator('td').nth(2)).toHaveText('2') // attempts
  await expect(row.locator('td').nth(3)).toHaveText('1') // retries
  await expect(row.locator('td').nth(5)).toHaveText('1') // failed
})

test('Python SDK replay that ends with an activity still in flight is Running with one pending activity', async ({ page }) => {
  await upload(page, 'py-swallowed-activity-cancellation.json')
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Running')
  await expect(stat(page, 'Events')).toContainText('48')
  await openTab(page, 'Retries & failures')
  const row = page.locator('tbody tr').first()
  await expect(row.locator('td').nth(1)).toHaveText('8') // 8 scheduled
  await expect(row.locator('td').nth(7)).toHaveText('1') // 1 pending
})

test('several uploaded files are compared; removing a file updates the comparison', async ({ page }) => {
  await fileInput(page).setInputFiles([fixturePath('py-signals-timers-updates.json'), fixturePath('java-async-activity-retry.json')])
  await expect(page.getByRole('heading', { name: 'Comparing 2 histories' })).toBeVisible()
  await expect(page.locator('tfoot tr')).toContainText('34') // 23 + 11 events
  await expect(page.locator('tfoot tr')).toContainText('9') // 6 + 3 Actions
  await page.getByRole('button', { name: 'Remove java-async-activity-retry.json' }).click()
  await expect(page.getByRole('heading', { name: /Comparing/ })).toHaveCount(0)
  await expect(stat(page, 'Billable Actions')).toContainText('6')
})

test('pasted JSON is analysed as "Pasted JSON"', async ({ page }) => {
  const text = JSON.stringify({ history: { events: fixtureJson('java-async-activity-retry.json').events } })
  await page.getByPlaceholder(/"events"/).fill(text)
  await expect(page.locator('.muted.mono').first()).toContainText('Pasted JSON')
  await expect(stat(page, 'Events')).toContainText('11')
  await expect(stat(page, 'Billable Actions')).toContainText('3')
})
