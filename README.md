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
