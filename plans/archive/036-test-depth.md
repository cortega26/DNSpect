# Plan 036: Test-depth completion and server-side watch-run filtering

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 930dfb6..HEAD -- backend/app/runner.py backend/app/main.py backend/tests/test_doq.py backend/tests/test_protocol_comparison.py frontend/src/lib/utils.ts frontend/src/lib/utils.test.ts frontend/src/lib/api.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (recommended after 031/035 so the DoQ test changes
  build on the unified gates)
- **Category**: tests + perf (deep-reaudit findings TC-04, TC-05, PERF-04's filtering half)
- **Planned at**: commit `930dfb6`, 2026-08-13

## Why this matters

Three test-depth gaps let regressions through: (1) the plain-benchmark DoQ
path is untested — `test_benchmark_run_doq_protocol` monkeypatches
`_measure_with_protocol` itself, so the real doq dispatch branch and
`_resolver_supports_protocol`'s doq gating never execute in tests; (2) the
pure presentation functions in `utils.ts` (`fmtMs`, `providersByGoal`,
`regionLabelKey`, `resolverGroup`, `resolverReliabilityScore`,
`resolverBlockingScore`) that drive ranking/recommendation display have zero
unit tests; (3) watch runs occupy up to 50 slots of every history API
response that non-UI consumers (CLI, scripts) read, and the server has no
way to exclude them. This plan closes all three. (Run-file retention/TTL is
deliberately NOT included — it is a product decision; see the index's
rejected list.)

## Current state

- `backend/tests/test_doq.py:196-233` — `test_benchmark_run_doq_protocol`
  monkeypatches `BenchmarkManager._measure_with_protocol` (line 213), so the
  real doq branch (`runner.py:1901-1905`: features lookup → `run_doq_query`)
  never runs; `_resolver_supports_protocol`'s doq branch
  (`runner.py:1880-1881`) is referenced by no test.
- `frontend/src/lib/utils.ts` — exports `fmtMs`, `providersByGoal`,
  `regionLabelKey`, `resolverGroup`, `resolverReliabilityScore`,
  `resolverBlockingScore` (grep the file for the exact list + signatures);
  `utils.test.ts` covers only `isWatchRun`/`latestUserRun`.
- `backend/app/runner.py:988-1040` — `list_history` returns ALL entries
  (capped 50) including `origin == "watch"` runs; the frontend filters
  client-side (`RunHistoryPanel.tsx:72-73`); `backend/app/main.py:121-123`
  — `GET /api/benchmarks/history` → `manager.list_history()`.
- The scheduler's baseline finder consumes `manager.list_history()`
  directly (watch.py) — server-side filtering must NOT break it.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 930dfb6..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Backend tests | `cd backend && . .venv/bin/activate && pytest tests/test_doq.py tests/test_watch.py -q` | all pass |
| Frontend tests | `cd frontend && npx vitest run src/lib/utils.test.ts` | all pass |
| Full gate | `make backend-check`     | exit 0 |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |

## Scope

**In scope**:
- `backend/tests/test_doq.py` — patch the transport, not the dispatcher
- `backend/tests/test_protocol_comparison.py` — `_resolver_supports_protocol` unit tests (or a new small file if cleaner)
- `frontend/src/lib/utils.test.ts` — table-driven presentation tests
- `backend/app/runner.py` — `list_history(include_watch_runs: bool = True)` parameter
- `backend/app/main.py` — history route passes `include_watch_runs` query param (default False at the route)
- `backend/tests/test_watch.py` — route-level filtering tests

**Out of scope** (do NOT touch, even though they look related):
- Run-file retention/TTL — product decision; recorded as rejected in the index.
- The frontend history filter (`RunHistoryPanel`) — already filters; the
  server filter is additive for non-UI consumers.
- The scheduler's baseline search — uses the manager directly (unfiltered);
  verified by test 5 below.
- WatchPanel/component tests — plan 032.

## Git workflow

- Branch: `plan/036-test-depth`
- Commits: `test(protocol): exercise the real doq dispatch and resolver gating`, `test(utils): cover presentation helpers`, `feat(history): support excluding watch runs at the API`. Merge commit: `merge: plan 036 — test depth and history filtering`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Exercise the real DoQ dispatch path

`backend/tests/test_doq.py` — change `test_benchmark_run_doq_protocol` to
monkeypatch `app.runner.run_doq_query` (returning a fixed ok sample) instead
of `_measure_with_protocol`, so the real doq branch (features lookup +
`run_doq_query` call with the hostname from the provider index) executes.
Assert the sample's `protocol == "doq"` flows into the done results.

Add `_resolver_supports_protocol` unit tests (in `test_doq.py` or
`test_protocol_comparison.py`): a 4-protocol × feature-presence matrix
(udp always true; dot with/without hostname; doh with/without url; doq with
flag+hostname / flag-only / hostname-only — the flag-only case must be
False per plan 035's unification).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_doq.py tests/test_protocol_comparison.py -q` → all pass.

### Step 2: Presentation helpers unit tests

`frontend/src/lib/utils.test.ts` — table-driven tests for each of
`fmtMs`, `providersByGoal`, `regionLabelKey`, `resolverGroup`,
`resolverReliabilityScore`, `resolverBlockingScore` (read each function's
actual behavior first; assert edge cases: null inputs, empty arrays,
unknown region/group keys, zero/negative scores). At least 2-3 cases per
function.

**Verify**: `cd frontend && npx vitest run src/lib/utils.test.ts` → all pass.

### Step 3: Server-side watch-run exclusion

1. `backend/app/runner.py` — `def list_history(self, *, include_watch_runs: bool = True) -> dict`:
   after building `runs`, filter
   `[r for r in runs if include_watch_runs or r.get("origin") != "watch"]`
   (before the `[:50]` cap, so non-watch runs are never starved out by
   watch runs — cap the FILTERED list).
2. `backend/app/main.py` — the route:
   `def benchmark_history(include_watch_runs: bool = Query(default=False))`
   → `manager.list_history(include_watch_runs=include_watch_runs)`.
   Default False = non-UI consumers get user runs by default.
3. The scheduler's baseline finder (watch.py) calls
   `manager.list_history()` with the default (True) — unchanged.

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from app.runner import BenchmarkManager
from app.main import app
print('imports-ok')"` → `imports-ok`.

### Step 4: Tests for the filter

`backend/tests/test_watch.py` (or `test_history_summary.py` — pick the
file with the closest fixtures):
1. `test_history_route_excludes_watch_runs_by_default` — seed a temp runs
   dir with one user run + one origin-watch run (write sidecars per the 030
   format); `GET /api/benchmarks/history` → only the user run;
   `?include_watch_runs=1` → both.
2. `test_list_history_unfiltered_at_manager` — `manager.list_history()` (no
   args) returns both (the scheduler's baseline path is preserved).
3. `test_watch_runs_do_not_starve_user_runs` — 40 watch runs + 30 user runs;
   the filtered route returns exactly the 50 newest USER runs (the cap
   applies after filtering).

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_watch.py tests/test_history_summary.py -q` → all pass.

### Step 5: Gates

**Verify**: `make backend-check` → exit 0; `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `cd frontend && npx playwright test --reporter=line` → all pass.

## Test plan

- `test_doq.py`/`test_protocol_comparison.py` — Step 1 (real dispatch +
  supports matrix).
- `utils.test.ts` — Step 2 table.
- `test_watch.py`/`test_history_summary.py` — Step 4 (route default,
  manager default, cap-after-filter).
- Existing suites stay green.

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_doq.py tests/test_protocol_comparison.py tests/test_watch.py tests/test_history_summary.py -q` — all pass
- [ ] `cd frontend && npx vitest run src/lib/utils.test.ts` — all pass
- [ ] `make backend-check` exits 0
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `cd frontend && npx playwright test --reporter=line` — all pass
- [ ] `grep -n "include_watch_runs" backend/app/runner.py backend/app/main.py` matches both
- [ ] `grep -n "run_doq_query" backend/tests/test_doq.py` matches (the test patches the transport now)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 036 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- The route default `False` breaks an e2e spec that asserts history
  contains watch-origin fixtures (the e2e fixtures seed user runs only —
  verify; if a spec seeds watch runs and asserts them, report instead of
  changing the default).
- The scheduler's baseline test fails after the filter change (it must
  not — the manager default is True; if the manager's signature change
  breaks a facade in test_watch.py, adapt the facade's signature, not the
  filter).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The route-level default (exclude watch runs) matches the frontend's
  client-side default; when the frontend eventually stops filtering
  client-side, the route param already carries the contract.
- The cap-after-filter change means history response lengths are now
  exactly 50 user runs when watches are active — the `useRunHistory` hook
  is unaffected (it renders whatever arrives).
- If a future watch-edit feature adds watch naming, the origin filter stays
  the right seam for "user vs watch" semantics.
