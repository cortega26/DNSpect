# DNSpect frontend testing

## Automated browser regression coverage

1. Required automated browser regression target: Playwright Chromium on Linux,
   using the Vite frontend and mocked API responses.
2. Required workflow coverage: cold initialization, one start POST, running
   state, terminal results, history selection, and the no-real-network rule.
3. Native GTK/WebKit packaged mode is not exercised by this suite; it remains
   a separate package/smoke responsibility.
4. Firefox and browser-WebKit are not claimed supported or tested until an
   owner approves their runtime/CI matrix.

## Commands

| Purpose | Command |
|---|---|
| Unit tests (Vitest) | `npm test` |
| Browser regression suite (Chromium) | `npm run test:e2e` |
| Browser suite, chromium project only | `npm run test:e2e -- --project=chromium` |
| Single spec file | `npm run test:e2e -- tests/e2e/workflows.spec.ts` |
| Full quality gate | `npm run lint && npm run typecheck && npm test && npm run test:e2e -- --project=chromium && npm run build` |

## Test isolation rules

- Browser tests must use mocked API/egress responses only; no DNS resolver,
  external IP, or GeoIP call may leave the test process. The fixture fails any
  unhandled network request, which is the enforcement mechanism.
- Tests wait for semantic UI state or named request completion; fixed sleeps
  and `networkidle` are not valid readiness signals.
- Add every new frontend fetch endpoint to `tests/e2e/fixtures.ts` in the same
  pull request as the production call.
