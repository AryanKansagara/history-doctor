# History Doctor

Temporal workflow history cost and limit analyzer. Runs entirely in the browser.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Light and dark themes follow [Material Design 3](https://m3.material.io/).

## Data and sources

Action counting, limits and pricing tiers follow docs.temporal.io (Cloud Actions, Limits, Pricing), checked 2026-11-16; see `/docs` in the app.
Tests run against real Event Histories from the Temporal SDK replay suites: `temporalio/sdk-typescript` and `temporalio/sdk-python` (MIT) and `temporalio/sdk-java` (Apache-2.0), stored unmodified in `src/fixtures/`.

## Test

```bash
npm test
```

### End-to-end tests

Playwright (Chromium) drives the production build served by `vite preview`:

```bash
npx playwright install chromium   # once
npm run test:e2e                  # builds, starts vite preview, runs e2e/
E2E_PORT=4500 npm run test:e2e    # use another port (default 4173; the run fails if it is taken)
```

The tests block all network access except the preview server, so nothing reaches Supabase, analytics or the web fonts, and they fail on uncaught page errors or on any new external host.
A known app bug is documented as a `test.fail` case that links its issue; it flips to a failure once the bug is fixed and then needs the `.fail` removed.

### CI and deployments

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` (job `test`): `npm ci`, build, unit tests, E2E.
`vercel.json` limits Git deployments to `main`, so pull request branches get no Vercel preview and GitHub CI is the gate.
