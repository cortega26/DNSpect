# Plan 032: The watch surface must come alive (polling, error state, delta units, tests)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- frontend/src/hooks/useWatch.ts frontend/src/hooks/useWatch.test.ts frontend/src/components/WatchPanel.tsx frontend/src/components/WatchPanel.test.tsx frontend/src/lib/utils.ts frontend/src/lib/utils.test.ts frontend/src/App.tsx frontend/tests/e2e/fixtures.ts frontend/tests/e2e/workflows.spec.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none (recommended after 031; independent otherwise)
- **Category**: bug/UX (deep-reaudit findings 2, 3, 16 — watch UI is stale, deltas misdisplay, errors are swallowed)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

The monitoring feature's core output never reaches the user: `useWatch`
fetches once on mount and after mutations — no polling — so active-run
transitions, `last_evaluated_at`, and **threshold alerts** (the feature's
whole point) appear only after a manual reload, by which time the 50-event
ring buffer may have evicted them. Worse, a dead watch backend renders as
"no watches" (the hook swallows fetch errors), and rate-metric alert deltas
display ~100× too small (backend emits 0–1 point deltas; the panel renders
`delta.toFixed(1)%`). This plan makes the surface honest: poll, surface
errors, render correct units, and pin all of it with the first WatchPanel
component tests + an e2e drill-down scenario.

## Current state

- `frontend/src/hooks/useWatch.ts:32-49` — `refresh()` is a stable
  `useCallback([])`; the mount effect deps are `[refresh]` → exactly one
  fetch; **no timers anywhere in the file**. Non-abort errors are swallowed:
  ```tsx
  try {
      const response = await getWatches(controller.signal)
      ...
  } catch { /* nothing */ }
  ```
  (`watchesLoading` flips false with `watches` untouched → the panel shows
  the empty state).
- `frontend/src/components/WatchPanel.tsx:53-56` — `formatMetricDelta`:
  ```tsx
  return `${delta.toFixed(1)}%`
  ```
  while `formatMetricValue` (46-51) scales rate metrics (`success_rate`,
  `failure_rate`) ×100. Backend `watch.py:_crosses_threshold` emits absolute
  0–1 point deltas for the rate pair. The rate set is also duplicated in
  `WatchPanel.tsx:15-21` (`RATE_METRICS`) while `watch.py:30-32` has an
  unused `RATE_METRICS`.
- `frontend/src/components/` — 13 components, **zero `*.test.tsx` files**
  (deep-reaudit TC-02).
- `frontend/tests/e2e/fixtures.ts:607` — `GET /api/watch` stubbed as
  `{watches: []}`; no e2e spec exercises watch interactions; the alert
  drill-down (`WatchPanel.tsx:214-222` → `App.tsx:1225` `onCompare` →
  `useRunComparison.selectPair`) has no automated coverage.
- `WatchPanel.tsx:94` — `handleRemove` calls `window.confirm` (blocks
  component-testing the delete flow as written; stub it in tests).
- The hooks have `POLL_INTERVAL_MS = 1000` (useBenchmarkSession.ts:20,
  useProtocolComparison.ts:7) and the refresh/abort/seq machinery that
  `useWatch` already has — follow those established patterns.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Hook tests | `cd frontend && npx vitest run src/hooks/useWatch.test.ts` | all pass |
| Component tests | `cd frontend && npx vitest run src/components/WatchPanel.test.tsx` | all pass |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |
| e2e | `cd frontend && npx playwright test --reporter=line` | 25+ passed |

## Scope

**In scope**:
- `frontend/src/hooks/useWatch.ts` — interval polling + error state
- `frontend/src/hooks/useWatch.test.ts` — poll/error tests
- `frontend/src/lib/utils.ts` — shared rate-metric set for the delta formatter
- `frontend/src/lib/utils.test.ts` — helper tests (if a helper is added)
- `frontend/src/components/WatchPanel.tsx` — error state, delta units,
  `confirm` seam
- `frontend/src/components/WatchPanel.test.tsx` (new)
- `frontend/tests/e2e/fixtures.ts` — settable watch fixtures
- `frontend/tests/e2e/workflows.spec.ts` — one watch drill-down scenario

**Out of scope** (do NOT touch, even though they look related):
- Backend watch behavior (`watch.py`) — plans 031/033 own it.
- The scheduler's alert-ring eviction semantics — unchanged; polling makes
  them visible sooner, which is the fix.
- `useBenchmarkSession`/`useProtocolComparison` — owned by plan 034.
- The unused `RATE_METRICS` in `watch.py` — deleted in plan 035.

## Git workflow

- Branch: `plan/032-watch-ui-alive`
- Commits: `feat(watch): poll watch status and surface fetch errors`,
  `fix(watch): render rate-metric deltas in percent`, `test(watch): component and e2e coverage`. Merge commit: `merge: plan 032 — watch UI alive`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Poll + error state in `useWatch`

1. Add `const [watchesError, setWatchesError] = useState<string | null>(null)`
   to the hook; set it on non-abort `getWatches` failures, clear it on
   success (mirror the 026 poll patterns).
2. Add interval polling: an effect that runs `refresh()` immediately and
   then every `10_000` ms while `document.visibilityState === 'visible'`
   (listen for the visibilitychange event to skip hidden-tab polls; use
   `window.setInterval` + the existing `refreshSeqRef`/abort machinery so
   overlapping polls abort cleanly; clear on unmount).
3. Keep `create`/`remove` refresh behavior; `create`/`remove` should also
   clear the error on success.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 2: Error state rendering in `WatchPanel`

`WatchPanel.tsx` — accept the hook's `watchesError` (via `useWatch` directly;
the panel already consumes the hook). When `watchesError` is set, render an
error row (role="alert", an existing i18n key or `watch.error.load` added to
all three languages — follow the i18n copy-test rule: add to ES source of
truth + EN/PT mirrors in the same commit) instead of the empty state. The
empty state must only render when the fetch succeeded and there are no
watches.

**Verify**: `cd frontend && npx vitest run src/lib/i18n.copy.test.ts` → pass.

### Step 3: Rate-metric delta units

1. `frontend/src/lib/utils.ts` — export
   `export const WATCH_RATE_METRICS: ReadonlySet<string> = new Set(['success_rate', 'failure_rate'])`
   with a comment that it mirrors `watch.py`'s relative/rate classification
   and `models.py`'s `DEFAULT_WATCH_THRESHOLDS` (the cross-language single
   source is documented, not shared).
2. `WatchPanel.tsx` — delete the local `RATE_METRICS`, import the shared
   one, and make `formatMetricDelta` scale rate metrics ×100:
   ```tsx
   if (WATCH_RATE_METRICS.has(metric)) return `${(delta * 100).toFixed(1)}%`
   return `${delta.toFixed(1)}%`
   ```
   (non-rate deltas stay percent already — relative deltas ARE percents from
   the backend).

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0.

### Step 4: Component tests — `WatchPanel.test.tsx` (new)

Model on `useWatch.test.ts` (jsdom pragma, `vi.mock('@/lib/api')`, real
`I18nProvider` wrapper; additionally mock `useWatch` itself via
`vi.mock('@/hooks/useWatch')` so the panel can be driven directly):

1. `renders empty state when no watches` (fetch succeeded, zero watches).
2. `renders error state instead of empty when fetch failed` (the Step 2
   contract).
3. `renders watch rows with status pill and alert count`.
4. `alert banner renders threshold events and calls onCompare with baseline and run ids` — the drill-down contract.
5. `delete calls onRemove after confirm` — stub `window.confirm` (vi.spyOn) for both true/false.
6. `create button disabled while a benchmark runs` (the `running` prop).

**Verify**: `cd frontend && npx vitest run src/components/WatchPanel.test.tsx` → 6 tests pass.

### Step 5: One e2e drill-down scenario

1. `frontend/tests/e2e/fixtures.ts` — make the watch fixture settable:
   `MockApi` gains `setWatches(watches: WatchEntry[])` (or a module-level
   mutable fixture the `GET /api/watch` handler reads), with a minimal
   `watchEntryWithAlert()` builder carrying one `threshold_alert` event
   (`baseline_id` + `run_id` that exist in the history fixtures).
2. `frontend/tests/e2e/workflows.spec.ts` — one scenario: seed the watch
   fixture with the alert-bearing entry, load the page, assert the alert row
   renders, click its compare button, assert the `RunComparisonPanel`
   appears (the `selectPair` wiring). Reuse the existing comparison-fixture
   patterns.

**Verify**: `cd frontend && npx playwright test --reporter=line` → all pass (previous 25 + the new scenario).

### Step 6: Full frontend gate

**Verify**: `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0.

## Test plan

- `useWatch.test.ts` — add: interval fires `refresh` repeatedly (fake
  timers), polling stops on unmount, error set on reject and cleared on
  success, no polls while hidden (visibilitychange stub).
- `WatchPanel.test.tsx` — the 6 cases in Step 4.
- `utils.test.ts` — `WATCH_RATE_METRICS` membership (only if a helper is
  exported; the set itself is data).
- e2e — the Step 5 drill-down scenario.
- Existing suites must stay green.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npx vitest run src/hooks/useWatch.test.ts src/components/WatchPanel.test.tsx src/lib/utils.test.ts` — all pass
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd frontend && npx playwright test --reporter=line` — all pass (previous 25 + 1 new)
- [ ] `grep -n "10_000\|setInterval" frontend/src/hooks/useWatch.ts` matches
- [ ] `grep -n "watchesError" frontend/src/hooks/useWatch.ts frontend/src/components/WatchPanel.tsx` matches both
- [ ] `grep -n "WATCH_RATE_METRICS" frontend/src/lib/utils.ts frontend/src/components/WatchPanel.tsx` matches both; the panel's local `RATE_METRICS` is gone
- [ ] `ls frontend/src/components/*.test.tsx` shows `WatchPanel.test.tsx`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 032 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the "Current state" locations doesn't match the excerpts.
- The backend delta units change (e.g. a fix in plan 034/035 makes the
  backend emit percents) — coordinate, don't double-scale; STOP and report.
- The e2e suite fails in the new scenario because `selectPair` wiring differs
  from the description — read `App.tsx:1225` and adapt the scenario; if the
  wiring itself is broken, STOP and report.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The 10s poll cadence is the v1 tuning knob; the ring-buffer eviction
  (50 events) is now much less likely to hide alerts, but a 50-alert burst
  between polls can still evict — acceptable v1, note it in
  `docs/MONITORING_MODE.md` if it bites.
- The cross-language unit contract (backend point-deltas for rate metrics,
  frontend ×100 display) is documented in the `WATCH_RATE_METRICS` comment;
  the future OS-notification channel must consume the same event shape.
- Plan 033 adds the backend reliability fixes; plan 035 deletes the backend
  `RATE_METRICS` dead constant — merge order between 032 and 035 is
  independent (different files).
