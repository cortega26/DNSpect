# Plan 027: Unit tests for the five orchestration hooks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d5002d0..HEAD -- frontend/package.json frontend/package-lock.json frontend/src/hooks/useBenchmarkSession.ts frontend/src/hooks/useProtocolComparison.ts frontend/src/hooks/useRunComparison.ts frontend/src/hooks/useRunHistory.ts frontend/src/hooks/useGuidedVerification.ts frontend/vite.config.ts frontend/src/hooks/*.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/026-frontend-session-fixes.md` (recommended — the
  tests assert the retry/cancel/refresh behaviors 026 implements; if 026 has
  not landed, write those assertions against current behavior and note it)
- **Category**: tests (audit finding 11 — post-`e09fd2d` churn reaudit)
- **Planned at**: commit `d5002d0`, 2026-08-11

## Why this matters

The plan-015 orchestration refactor extracted all run-session logic into five
hooks (`useBenchmarkSession`, `useProtocolComparison`, `useRunComparison`,
`useRunHistory`, `useGuidedVerification`) — the polling loops, abort wiring,
stale-response seq guards, and unmount cleanup where races and
setState-after-unmount bugs live — and shipped them with **zero unit tests**.
The only coverage is slow Playwright e2e. Plan 026 then fixes four behaviors
in those hooks; without a unit net, both the fixes and the hooks remain
unverifiable except through e2e. This plan adds `@testing-library/react`
+ `jsdom` devDeps (neither exists today — all current tests are pure-function
`lib/` tests in the node environment) and one test file per hook, asserting
behavior, not implementation.

## Current state

- `frontend/src/hooks/` — five hook files, no `*.test.ts` siblings. The only
  test files in `frontend/src` are 11 pure-function suites in `lib/` and
  `src/lib/*.test.ts`; `frontend/tests/e2e/` has Playwright specs
  (`workflows.spec.ts`, `history-comparison.spec.ts`,
  `protocol-comparison.spec.ts`, `accessibility-i18n.spec.ts`).
- `frontend/package.json` — devDeps include `vitest` (check the exact version
  via `npm ls vitest` or package.json) but **no** `@testing-library/react`,
  `@testing-library/dom`, `jsdom`, or `react-test-renderer` (grep confirms).
- No vitest `environment` config found in `vite.config.ts` (existing tests
  run in node). Vitest supports per-file environments via a pragma comment:
  `// @vitest-environment jsdom` at the top of a test file — use that, do NOT
  change global config.
- `frontend/src/hooks/useBenchmarkSession.ts:85-125` — the poll loop:
  `pollOnce` with `pollInFlightRef` overlap guard, `scheduleNext(delayMs)`,
  `stopPolling()`, abort via `pollAbortRef`. (Plan 026 adds
  `consecutiveErrorsRef` retry/backoff here and in `useProtocolComparison`.)
- `frontend/src/hooks/useRunHistory.ts:11-48` — `refresh` with
  `refreshSeqRef` + `abortRef`; effect re-runs on `[refresh, sessionStatusId]`.
- `frontend/src/hooks/useRunComparison.ts:28-39` — `selectPair` with
  `requestSeqRef` + `abortRef`.
- `frontend/src/hooks/useGuidedVerification.ts:54-120` — `verify` with
  `verifySeqRef` + `abortRef` (plan 026 wires the real controller).
- `frontend/src/hooks/useProtocolComparison.ts:49-76` — preflight with
  abort-and-restart; poll at 134-138.
- `frontend/src/lib/api.ts` — the fetch layer, module-mockable via `vi.mock`.
- i18n: the hooks call `useI18n()`/`t()`; tests must provide a wrapper or
  mock the i18n context (check `frontend/src/lib/i18n-context.ts`/`i18n.tsx`
  for the provider shape; `renderHook` with a wrapper that renders
  `I18nProvider` with `esTranslations` is the pattern to use).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat d5002d0..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Deps | `cd frontend && npm install --save-dev @testing-library/react @testing-library/dom jsdom` | lockfile updated, exit 0 |
| Hook tests | `cd frontend && npx vitest run src/hooks --environment node` | all pass (environment per-file) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |

## Scope

**In scope**:
- `frontend/package.json`, `frontend/package-lock.json` — devDeps addition
- `frontend/src/hooks/useBenchmarkSession.test.ts` (new)
- `frontend/src/hooks/useRunHistory.test.ts` (new)
- `frontend/src/hooks/useRunComparison.test.ts` (new)
- `frontend/src/hooks/useGuidedVerification.test.ts` (new)
- `frontend/src/hooks/useProtocolComparison.test.ts` (new)

**Out of scope** (do NOT touch, even though they look related):
- The hooks themselves (`frontend/src/hooks/*.ts`) — behavior changes are
  plan 026's job; this plan only tests. If a test reveals a real bug beyond
  026's scope, report it in NOTES, don't fix it here.
- `frontend/vite.config.ts` and any global test config — per-file jsdom
  pragma only.
- Backend files.
- e2e specs (`frontend/tests/e2e/`) — do not modify; they must stay green.

## Git workflow

- Branch: `plan/027-hook-unit-tests`
- Commits: `chore(deps): add react testing library devDeps`, `test(hooks): cover the five orchestration hooks`. Merge commit on main:
  `merge: plan 027 — orchestration hook unit tests`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the testing devDeps

Check the installed versions first: `cd frontend && npm ls @testing-library/react @testing-library/dom jsdom vitest`. Then:

`cd frontend && npm install --save-dev @testing-library/react @testing-library/dom jsdom`

(Choose versions compatible with the installed `vitest` major and React 18; `npm` resolves them. The repo's "never `npm install`" rule applies to dependency drift — adding a devDep requires a lockfile update, which is exactly this.)

**Verify**: `grep -n "testing-library\|jsdom" frontend/package.json` matches the three new devDeps; `cd frontend && npm ci --dry-run` (or `npm ls --depth=0`) exits 0 with no peer conflicts.

### Step 2: Test scaffolding

Create one shared helper in each test file (or a `frontend/src/hooks/test-utils.tsx` if duplication across all five files exceeds ~20 lines — keep it simple; duplication is acceptable in tests, prefer per-file helpers):

- A `renderHookWithI18n(renderHookFn)` wrapper that wraps `renderHook` (from `@testing-library/react`) in the app's `I18nProvider` (read `frontend/src/lib/i18n-context.ts` and `i18n.tsx` for the exact provider props; `esTranslations` is exported from `i18n-translations.ts`). Use `act` around state-changing calls (the RTL `act` is re-exported or import from `react`).
- `vi.mock('@/lib/api', ...)` per test file to stub only the api functions that hook uses (`getBenchmark`, `getBenchmarkHistory`, `compareRuns`, `getSystemDns`, `probeResolvers`, `runProtocolComparisonPreflight`, `getCapabilities`). Match the actual import specifiers used by the hooks (check the hook files' import lines — they may import named functions directly).
- `vi.useFakeTimers()` in the poll-loop tests; advance with `act(() => vi.advanceTimersByTime(1000))`.

**Verify**: a minimal smoke test (`frontend/src/hooks/useRunHistory.test.ts` with one trivial mount assertion) passes: `cd frontend && npx vitest run src/hooks/useRunHistory.test.ts` → 1 passed.

### Step 3: `useRunHistory.test.ts`

1. `fetches history on mount` — mock `getBenchmarkHistory` resolving `{runs: [...]}`; assert the hook's `history` reflects it.
2. `refresh re-fetches` — call `refresh()`; assert `getBenchmarkHistory` called twice.
3. `stale response dropped after re-mount/session change` — start a fetch, change `sessionStatusId` (re-render with a new prop), resolve the OLD promise late; assert `history` reflects only the second result (the `refreshSeqRef` guard).
4. `aborts in-flight fetch on unmount` — resolve never; unmount; assert the abort signal was fired (inspect the `signal.aborted` captured by the mock) and no setState-after-unmount warning/error.
5. If plan 026's App-level refresh wiring landed, add: `refresh is stable` — identity stable across renders (supports the App effect).

### Step 4: `useBenchmarkSession.test.ts`

1. `starts polling until terminal` — mock `getBenchmark` to return `running` then `done`; assert `status` transitions and that `getBenchmark` stops being called after `done` (fake timers).
2. `stale poll response rejected` — trigger a poll, change the session (re-run hook with a new id), resolve the old promise late; assert `status` not updated by it (the `isActivePollSession` guard).
3. `unmount stops polling` — unmount mid-run; advance timers; assert no further `getBenchmark` calls and no state updates.
4. If plan 026 landed: `transient error retries with backoff then gives up` — `getBenchmark` rejects 5 times then succeeds; assert 6th call happens on the backoff cadence and `status` eventually updates; and `permanent failure stops after 5 consecutive errors`.
5. `overlapping polls are serialized` — slow first response, second tick scheduled; assert `pollInFlightRef`-style behavior (one in-flight at a time).

### Step 5: `useRunComparison.test.ts`

1. `selectPair fetches comparison` — mock `compareRuns`; assert it's called with `(baselineId, candidateId)` and the result lands in `comparison`.
2. `clear aborts and resets` — `selectPair(null, null)`; assert abort fired and state cleared.
3. `out-of-order responses dropped` — two `selectPair` calls, resolve the first late; assert the displayed comparison is the second's.

### Step 6: `useGuidedVerification.test.ts`

1. `verify runs probe flow` — mock `getSystemDns` + `probeResolvers`; call `verify({...})`; assert `probeResolvers` called with the merged resolver set and the result is stored.
2. If plan 026 landed: `cancel aborts in-flight probe` — start `verify` with a pending `probeResolvers`; call `cancel()`; assert the mock's signal was aborted and no state updates land.
3. `stale verify results dropped` — two verifies, first resolves late; assert only the second's result is set.

### Step 7: `useProtocolComparison.test.ts`

1. `preflight fires on payload change` — mock `runProtocolComparisonPreflight`; re-render with a changed payload; assert called.
2. `preflight aborts previous call` — two payload changes; assert the first request's signal aborted.
3. If plan 026 landed: `poll retries transient errors with backoff then stops after cap` — mirror Step 4.4's assertions.

### Step 8: Full gate

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0 (the full `npm test` runs the lib suites plus the five new hook suites).

## Test plan

- Five new `frontend/src/hooks/*.test.ts` files as specified. Every assertion is behavioral (what the hook exposes), not implementation-coupled (no peeking at refs except where the abort signal is asserted via the mocked fetch).
- Fake timers only in poll-loop tests; real timers elsewhere.
- All API calls stubbed via `vi.mock('@/lib/api')` — no network, no backend.
- The existing 11 lib suites and the e2e specs must stay green (untouched).

## Done criteria

ALL must hold:

- [ ] `cd frontend && npx vitest run src/hooks` — all new suites pass (≥ 15 tests across the five files)
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `ls frontend/src/hooks/*.test.ts` shows the five files
- [ ] `grep -rn "@vitest-environment jsdom" frontend/src/hooks/*.test.ts` matches all five files
- [ ] `grep -n "@testing-library/react" frontend/package.json` and `grep -n "jsdom" frontend/package.json` both match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 027 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- The hooks' actual exported interfaces differ from the descriptions (e.g. a
  hook returns a different shape) — read the hook file first; adapt the test
  to the real interface, but if the interface change needed is a behavior
  fix, STOP and report.
- `npm install --save-dev ...` produces peer-dependency conflicts with the
  installed `vitest`/React versions — report the resolved-versions question
  instead of forcing versions.
- A test you write per this plan's spec fails because of a genuine hook bug
  OUTSIDE plan 026's fixes — keep the failing test (it documents the bug),
  mark it `skip` with a comment, and report it in NOTES. Do not fix the hook.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require touching `vite.config.ts`, the hooks, the e2e
  specs, or any backend file to proceed.

## Maintenance notes

- The five test files are the regression net for plan 026's fixes AND for
  any future hook work (the monitoring `useWatch` hook in the plan-021 build
  should copy these patterns). Keep the behavioral-assertion style.
- The jsdom pragma keeps global config clean; if the suite grows DOM-heavy,
  a future plan may move `environment: 'jsdom'` into config — not now.
- When the e2e suite and these unit tests both cover a behavior (e.g. poll
  stop), prefer trusting the unit test for regressions and the e2e for
  integration — do not duplicate the same assertions in both.
