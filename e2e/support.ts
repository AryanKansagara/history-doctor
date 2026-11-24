import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const fixturePath = (name: string) => fileURLToPath(new URL(`../src/fixtures/${name}`, import.meta.url))
export const fixtureJson = (name: string) => JSON.parse(readFileSync(fixturePath(name), 'utf8')) as { events: Record<string, unknown>[] }

/** The only third-party hosts index.html may contact (web fonts). Anything else is a new external dependency. */
const ALLOWED_BLOCKED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

type Guard = { blocked: string[]; pageErrors: string[] }

/**
 * Every test gets a page that cannot reach the network beyond the preview server (so no Supabase, analytics or
 * fonts), and that fails if the app throws an uncaught error or tries a new external host.
 */
export const test = base.extend<{ page: Page; guard: Guard }>({
  guard: async ({}, use) => use({ blocked: [], pageErrors: [] }),
  page: async ({ page, baseURL, guard }, use) => {
    const origin = new URL(baseURL!).origin
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue()
      guard.blocked.push(url.host)
      return route.abort()
    })
    page.on('pageerror', e => guard.pageErrors.push(e.message))
    await use(page)
    expect(guard.pageErrors, 'uncaught page errors').toEqual([])
    expect(guard.blocked.filter(h => !ALLOWED_BLOCKED_HOSTS.has(h)), 'unexpected external requests').toEqual([])
  },
})
export { expect }

export const sampleButton = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true })
export const fileInput = (page: Page) => page.locator('input[type=file]')
export const openTab = (page: Page, name: string) => page.getByRole('tab', { name }).click()

/** The overview card with the given label, e.g. stat(page, 'Events'). */
export const stat = (page: Page, label: string): Locator =>
  page.locator('.stat').filter({ has: page.locator('.label', { hasText: new RegExp(`^${label}`, 'i') }) })

/** The value cell of the "By action kind" table row for an Action kind. */
export const actionCount = (page: Page, kind: string): Locator =>
  page.locator('tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${kind}`) }) }).locator('td.num').first()

export const upload = (page: Page, file: string | { name: string; text: string }) =>
  typeof file === 'string'
    ? fileInput(page).setInputFiles(fixturePath(file))
    : fileInput(page).setInputFiles({ name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.text) })

/** The verdict text the Recommendations tab opens with. */
export const HEALTHY_VERDICT = /No issues found|comfortably within limits/

/** A finding on the Recommendations tab, by its title. */
export const finding = (page: Page, title: string): Locator => page.locator('.finding .head').filter({ hasText: title })
