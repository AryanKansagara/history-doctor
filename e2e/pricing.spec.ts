import { expect, test, openTab, sampleButton, stat } from './support.ts'

const priceInput = (page: import('@playwright/test').Page) => page.locator('.controls input[type=number]').nth(0)
const perDayInput = (page: import('@playwright/test').Page) => page.locator('.controls input[type=number]').nth(1)

test.beforeEach(async ({ page }) => {
  await page.goto('/app')
})

test('changing the price per million Actions changes every cost figure', async ({ page }) => {
  await sampleButton(page, 'Healthy order fulfillment').click() // 8 Actions
  await openTab(page, 'Actions & cost')
  await expect(priceInput(page)).toHaveValue('50')
  await expect(stat(page, 'Cost per run')).toContainText('$0.00040') // 8 / 1M x $50
  await expect(stat(page, 'Cost per 1,000 runs')).toContainText('$0.40')
  await expect(stat(page, 'Monthly at 1,000/day')).toContainText('$12.00') // 8 x 1,000 x 30 / 1M x $50

  await priceInput(page).fill('100')
  await expect(stat(page, 'Cost per run')).toContainText('$0.00080')
  await expect(stat(page, 'Cost per 1,000 runs')).toContainText('$0.80')
  await expect(stat(page, 'Monthly at 1,000/day')).toContainText('$24.00')
  // The overview card above the tabs follows the same input.
  await expect(stat(page, 'Cost of this run')).toContainText('$0.00080')
  await expect(stat(page, 'Cost of this run')).toContainText('at $100 per million Actions')

  await priceInput(page).fill('0')
  await expect(stat(page, 'Cost per run')).toContainText('$0')
  await expect(stat(page, 'Cost of this run')).not.toContainText('$0.0')
})

test('changing executions per day scales the monthly figures but not the per-run cost', async ({ page }) => {
  await sampleButton(page, 'Healthy order fulfillment').click()
  await openTab(page, 'Actions & cost')
  await perDayInput(page).fill('2000')
  await expect(stat(page, 'Monthly at 2,000/day')).toContainText('$24.00') // 8 x 2,000 x 30 = 480,000 Actions x $50/M
  await expect(page.getByText('480,000 Actions')).toBeVisible()
  await expect(stat(page, 'Cost per run')).toContainText('$0.00040')
})

test('volume tiers are cheaper than the flat price once past 5M Actions a month', async ({ page }) => {
  await sampleButton(page, 'Subscription entity near limits').click() // 1,893 Actions per run
  await openTab(page, 'Actions & cost')
  // 1,893 x 1,000 x 30 = 56.79M Actions: 5M x $50 + 5M x $45 + 10M x $40 + 30M x $35 + 6.79M x $30 = $2,128.70
  await expect(stat(page, 'Monthly with volume tiers')).toContainText('$2,129')
  await expect(stat(page, 'Cost per run')).toContainText('$0.095') // 1,893 / 1M x $50 = $0.09465
  // Flat pricing at the list price is dearer: $2,839.50
  await expect(stat(page, 'Monthly at 1,000/day')).toContainText(/\$2,8(39|40)/)
})

test('including the heartbeat estimate raises the Actions per run', async ({ page }) => {
  await sampleButton(page, 'Subscription entity near limits').click()
  await openTab(page, 'Actions & cost')
  const actions = stat(page, 'Actions per run').locator('.value')
  await expect(actions).toHaveText('1,893')
  await page.getByText('include estimate').click()
  await expect(actions).not.toHaveText('1,893')
  const n = Number((await actions.innerText()).replace(/,/g, ''))
  expect(n).toBeGreaterThan(1893)
  await expect(page.getByText('Activity heartbeats (estimated)')).toBeVisible()
})

test('comparison monthly cost follows the price input', async ({ page }) => {
  await sampleButton(page, 'Healthy order fulfillment').click()
  await sampleButton(page, 'Payment retry storm').click()
  await expect(page.getByRole('heading', { name: 'Comparing 2 histories' })).toBeVisible()
  // (8 + 78) Actions x 1,000/day x 30 = 2.58M Actions x $50/M = $129
  await expect(page.locator('tfoot tr')).toContainText('$129')
  await openTab(page, 'Actions & cost')
  await priceInput(page).fill('100')
  await expect(page.locator('tfoot tr')).toContainText('$258')
})
