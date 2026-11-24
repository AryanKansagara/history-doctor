import { defineConfig, devices } from '@playwright/test'

// E2E runs against the production build served by `vite preview`.
// Override the port with E2E_PORT when 4173 is taken (e.g. several checkouts on one machine).
const port = Number(process.env.E2E_PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`E2E_PORT must be a port number, got "${process.env.E2E_PORT}"`)

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Dates and numbers are rendered with the browser locale and zone; pin them so assertions are stable.
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // strictPort + no reuse: if the port is already taken the run fails instead of testing someone else's server.
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
