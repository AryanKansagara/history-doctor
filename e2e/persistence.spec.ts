import { expect, test, openTab, stat } from './support.ts'

test('the chosen theme survives a reload and applies before the app renders', async ({ page }) => {
  await page.goto('/app')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme-mode', 'dark') // the site default
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(html).toHaveAttribute('data-theme-mode', 'light')
  expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe('light')

  await page.reload()
  await expect(html).toHaveAttribute('data-theme-mode', 'light')
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()

  // It also holds on the other pages and in a second tab of the same browser context.
  await page.goto('/docs')
  await expect(html).toHaveAttribute('data-theme-mode', 'light')
  const other = await page.context().newPage()
  await other.goto('/')
  await expect(other.locator('html')).toHaveAttribute('data-theme-mode', 'light')
  await other.close()
})

test('an unrecognised stored theme falls back to the default', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('themeMode', 'purple'))
  await page.goto('/app')
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark')
})

test('?sample= links restore the same analysis after a reload', async ({ page }) => {
  await page.goto('/app?sample=healthy,retry')
  await expect(page.getByRole('heading', { name: 'Comparing 2 histories' })).toBeVisible()
  await expect(page.locator('tfoot tr')).toContainText('74') // 41 + 33 events
  await expect(page.locator('tfoot tr')).toContainText('86') // 8 + 78 Actions

  await page.reload()
  await expect(page).toHaveURL(/\?sample=healthy,retry$/)
  await expect(page.getByRole('heading', { name: 'Comparing 2 histories' })).toBeVisible()
  await expect(page.locator('tfoot tr')).toContainText('86')
  await expect(page.locator('.chip')).toHaveCount(2)
})

test('an unknown ?sample= id is ignored', async ({ page }) => {
  await page.goto('/app?sample=nope')
  await expect(page.getByText('Paste a history, drop a file, or load a sample to get started.')).toBeVisible()
  await expect(page.locator('.stat')).toHaveCount(0)
})

test('/app/ and deep links to the tool and docs load via the SPA fallback', async ({ page }) => {
  await page.goto('/app/')
  await expect(page.getByRole('heading', { name: 'Diagnose a Temporal workflow history' })).toBeVisible()
  await page.goto('/docs')
  await expect(page.getByRole('link', { name: 'temporalio/sdk-typescript' })).toBeVisible()
})

test('landing page opens the tool; the tool starts empty after a reload (nothing is stored)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Catch Temporal history limits')
  await page.getByRole('button', { name: /try/i }).first().click()
  await expect(page).toHaveURL(/\/app$/)
  await page.getByRole('button', { name: 'Healthy order fulfillment', exact: true }).click()
  await expect(stat(page, 'Events')).toContainText('41')
  await openTab(page, 'Limits')
  await page.reload()
  // Histories live only in page memory; they are not written to storage.
  await expect(page.locator('.stat')).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))
  expect(stored).not.toMatch(/WorkflowExecution|OrderFulfillment/)
})
