# Plan 038: Frontend structure (shared polling engine, App extraction, fixtures consolidation)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- frontend/src/hooks/usePolling.ts frontend/src/hooks/useBenchmarkSession.ts frontend/src/hooks/useProtocolComparison.ts frontend/src/hooks/useRunHistory.ts frontend/src/hooks/useWatch.ts frontend/src/hooks/useBenchmarkSession.test.ts frontend/src/hooks/useProtocolComparison.test.ts frontend/src/hooks/useRunHistory.test.ts frontend/src/hooks/useWatch.test.ts frontend/src/App.tsx frontend/src/lib/utils.ts frontend/tests/e2e/fixtures.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (recommended AFTER 032/034 so the polling extraction
  includes their fixes; coordinate merge order)
- **Category**: tech debt (deep-reaudit findings TD-04, TD-05, TD-09)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

Three structural debts from the deep reaudit: (1) the trickiest async code
in the frontend — the poll loop with abort/seq guards, in-flight
serialization, and exponential backoff — exists in **two near-identical
copies** (`useBenchmarkSession` vs `useProtocolComparison`), and the simpler
refresh pattern is duplicated verbatim in `useRunHistory` and `useWatch`;
a fix to one poller silently skips the other. (2) `App.tsx` (1,654 lines)
still owns ~30 `useState`s, ~20 `useMemo` derivations, an ~80-line
keyboard-a11y locale menu, and builds the target snapshot **three times**
with the same shape. (3) `frontend/tests/e2e/fixtures.ts` (748 lines) is
nearly as large as all four spec files combined and triplicates the provider
catalog (data file + `App.tsx`'s `FALLBACK_PROVIDERS` + fixtures). The plan
extracts the polling engine into one tested hook, trims App.tsx at its
three sharpest seams, and consolidates the fixtures.

## Current state

- `frontend/src/hooks/useBenchmarkSession.ts:66-153` vs
  `useProtocolComparison.ts:87-164` — the poll loop (abort, in-flight
  guard, `min(1000 * 2**(n-1), 30_000)` backoff, 5-consecutive-error stop,
  120ms in-flight reschedule) re-implemented near line-for-line.
  `useRunHistory.ts:17-37` vs `useWatch.ts:20-40` — the refresh pattern
  (seq counter + abort + mounted guard) duplicated.
- `frontend/src/App.tsx` — three target-snapshot builders:
  `protocolComparisonPayload` (391-423), `watchSessionConfig` (425-456),
  `handleStart` (777-795); the locale-menu keyboard handler (~702-766);
  three copyStatus-reset timer effects (~659-675); `sortedResults` is a
  bare alias of `decisiveRanking` (~499); the CSV export uses a raw inline
  `fetch` (889-907) bypassing `lib/api`.
- `frontend/tests/e2e/fixtures.ts` — the `MockApi` dispatcher + builders +
  catalog in one file; the provider trio defined three times:
  `data/dns_providers.es.json`, `App.tsx:68-120` (`FALLBACK_PROVIDERS`),
  `fixtures.ts:52-86`.
- The hooks each have co-located test files (the 027 wave) — the migration
  net for the extraction.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Hook tests | `cd frontend && npx vitest run src/hooks` | all pass |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e | `cd frontend && npx playwright test --reporter=line` | all pass |

## Scope

**In scope**:
- `frontend/src/hooks/usePolling.ts` (new) — the shared poll engine
- `frontend/src/hooks/useBenchmarkSession.ts`, `useProtocolComparison.ts`,
  `useRunHistory.ts`, `useWatch.ts` — re-expressed on the engine
- The four hooks' test files — migrated/extended (no behavior regression)
- `frontend/src/App.tsx` — `useTargetSnapshot` extraction, `LocaleMenu`
  component, copy-timer dedup
- `frontend/src/lib/utils.ts` — `useTargetSnapshot` lives here if it needs
  a non-hook pure part (or `hooks/useTargetSnapshot.ts` if hook-only)
- `frontend/tests/e2e/fixtures.ts` — split into `catalog.ts` + `mockApi.ts`
  + `fixtureBuilders.ts` (imports preserved via the existing `./fixtures`
  spec imports — keep `fixtures.ts` as the re-export barrel)

**Out of scope** (do NOT touch, even though they look related):
- The L-sized `runner.py` split (TD-03) and React 19 (6-01) — recorded as
  rejected-for-now in the index (post-release).
- The `FALLBACK_PROVIDERS` catalog source (TD-09's second half) — generating
  it from the data file requires build-time plumbing; record as a follow-up
  note, do not implement here.
- Backend code; watch behavior (plans 031-036).
- The CSV export inline fetch — App.tsx's behavior is out of scope beyond
  the three extractions named.

## Git workflow

- Branch: `plan/038-frontend-structure`
- Commits: `refactor(hooks): extract shared polling engine`,
  `refactor(components): extract locale menu and snapshot builder`,
  `refactor(e2e): split fixtures into catalog, mock api, and builders`.
  Merge commit: `merge: plan 038 — frontend structure`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract `usePolling`

Design (follow the existing behavior EXACTLY — the hooks' tests are the
contract):

```tsx
interface UsePollingOptions {
  fetchFn: (signal: AbortSignal) => Promise<void>   // caller does the state updates
  shouldContinue: (signal: AbortSignal) => boolean  // session/mount guard
  intervalMs?: number                               // default 1000
  backoff?: { maxAttempts: number; baseMs: number; maxMs: number }
}
```

`usePolling(options)` returns `{ start, stop, isPolling }` and owns: the
timer, the in-flight guard (120ms reschedule while in-flight), the abort
controller per poll, the consecutive-errors backoff (reset on success via a
`onSuccess` callback the caller wires, or a returned `reportSuccess()`),
and cleanup on unmount. The two session hooks re-express their `pollOnce`
bodies as `fetchFn` (keeping their own status/error state updates —
`useBenchmarkSession`'s `pollFailedRef` clear-on-recovery and
`useProtocolComparison`'s, per plans 028/034, live in the callers).

**Verify**: `cd frontend && npx vitest run src/hooks/useBenchmarkSession.test.ts src/hooks/useProtocolComparison.test.ts` → all pass UNCHANGED (the extraction is behavior-preserving; do not modify the test assertions to make them pass).

### Step 2: Re-express the refresh hooks

`useRunHistory` and `useWatch` — replace their duplicated refresh bodies
with a shared `useRefresh` helper (extracted in the same commit; seq +
abort + mounted guard), keeping their exposed interfaces identical
(`refresh`, `history`/`watches`, loading/error state per plan 032 where
applicable).

**Verify**: `cd frontend && npx vitest run src/hooks/useRunHistory.test.ts src/hooks/useWatch.test.ts` → all pass UNCHANGED.

### Step 3: App.tsx extractions

1. `hooks/useTargetSnapshot.ts` — one builder from the current triple:
   input (resolvers, scope, systemDns, providers, selection source) →
   `TargetSnapshot`; migrate `protocolComparisonPayload`,
   `watchSessionConfig`, and `handleStart` to call it. The three call sites
   must produce byte-identical payloads (the e2e fixtures pin the shapes).
2. `components/LocaleMenu.tsx` — move the keyboard-a11y locale menu
   (~702-766) out of App; same markup, same key handling, same i18n.
3. Dedup the copyStatus-reset timer effects into one `useCopyStatusTimer`
   helper (or a single effect keyed on the copy-status state).
4. Delete the `sortedResults` alias (use `decisiveRanking` directly at the
   call site).

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0; `cd frontend && npx playwright test --reporter=line` → all pass (the e2e suite pins App-level behavior).

### Step 4: Fixtures consolidation

Split `frontend/tests/e2e/fixtures.ts` into:
- `catalog.ts` — the provider fixtures (from `fixtures.ts:52-86`) as the
  single fixture source, with a comment noting the third copy lives in
  `App.tsx`'s `FALLBACK_PROVIDERS` (generation from the data file is the
  recorded follow-up);
- `mockApi.ts` — `MockApi`, the dispatcher, deferreds, and the handler
  registration (the current `setDefaults` bodies);
- `fixtureBuilders.ts` — `makeStats`, `doneBenchmark`,
  `protocolComparisonStatusFixture`, watch fixtures, etc.
- `fixtures.ts` — re-export barrel so the four spec files' imports
  (`import { MockApi, doneBenchmark, ... } from './fixtures'`) keep
  working unchanged.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0; `cd frontend && npx playwright test --reporter=line` → all pass (specs untouched).

### Step 5: Gates

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `cd frontend && npx playwright test --reporter=line` → all pass; `git status` shows only in-scope files.

## Test plan

- The four hook test files pass UNCHANGED (the extraction contract).
- New: one small `usePolling.test.ts` (the engine's own contract: start/stop
  idempotency, backoff cap, in-flight serialization) — only if the engine
  has behavior the hook tests don't already pin; prefer no new file if the
  migration covers it.
- e2e suite: the regression net for the App extractions and fixtures split.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npx vitest run src/hooks` — all pass (existing suites, unchanged assertions)
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd frontend && npx playwright test --reporter=line` — all pass
- [ ] `ls frontend/src/hooks/usePolling.ts` exists; `grep -rn "usePolling" frontend/src/hooks/useBenchmarkSession.ts frontend/src/hooks/useProtocolComparison.ts` matches both
- [ ] `grep -rn "useTargetSnapshot" frontend/src/App.tsx` matches ≥ 2 (call sites)
- [ ] `ls frontend/tests/e2e/catalog.ts frontend/tests/e2e/mockApi.ts frontend/tests/e2e/fixtureBuilders.ts` all exist; `frontend/tests/e2e/fixtures.ts` is a re-export barrel
- [ ] `wc -l frontend/src/App.tsx` < 1400 (was 1654)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 038 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any existing hook test requires assertion changes to pass after the
  extraction (the contract is byte-identical behavior) — if a test exposes
  a behavior difference, the extraction is wrong; fix the extraction, or
  STOP and report if the difference is a real bug found by the migration.
- The e2e suite fails after the fixtures split or App extraction in a way
  that requires touching spec files (the specs must stay untouched) — STOP
  and report.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `usePolling` is the single seam for future polling surfaces (the watch
  status poll in plan 032, the future OS-notification status) — new
  polling hooks must consume it, not copy it.
- The `useTargetSnapshot` builder is now the single place the snapshot
  shape is constructed in the frontend; the backend's `TargetSnapshot`
  semantics (models.py) remain the contract — keep the comment linking
  them.
- The fixture split keeps `fixtures.ts` as the barrel so specs never see
  the internal layout; future fixture work goes into the builder file.
- The `FALLBACK_PROVIDERS` duplication note (data file vs App) stays
  documented in `catalog.ts` until the build-time generation follow-up.
