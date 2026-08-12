# Plan 021: Continuous monitoring mode — design spike (roadmap items 1–3)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 087e5ff..HEAD -- backend/app/runner.py backend/app/cli.py frontend/src/hooks/useRunComparison.ts frontend/src/hooks/useRunHistory.ts frontend/src/components/RunComparisonPanel.tsx frontend/src/components/RunHistoryPanel.tsx frontend/src/lib/api.ts`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L (spike — design doc + validated prototype, no production code)
- **Risk**: LOW (no production code touched)
- **Depends on**: none (reads plan 019/020 context where relevant; not blocked by them)
- **Category**: direction (README roadmap items 1–3: continuous monitoring, scheduled benchmarks, alerting)
- **Planned at**: commit `087e5ff`, 2026-08-11

## Why this matters

The README roadmap's three headline items — continuous monitoring (background
re-checking at intervals), scheduled/recurring benchmarks, and alerting when a
resolver degrades — are the product's stated endgame, and zero scheduler or
alert code exists anywhere in the repo. But the hard parts are already built:
runs persist to disk with immutable manifests (`runner.py:874-953`,
`_persist_run`), manifest-gated comparisons produce typed deltas
(`compare_runs` at `runner.py:1495`, `RunComparisonResponse` in
`models.py:227-236`), ranking is deterministic, and the manager has bounded
admission control. A monitor is, in essence: *start a run on a pinned target
snapshot on a schedule, compare it against the last manifest-identical run,
and surface deltas that cross a threshold.* This spike decides the design and
validates it against recorded fixture runs — so the maintainer can approve a
build plan with decisions already made, not 30 open questions.

## Current state

- `backend/app/runner.py:753-809` — `BenchmarkManager.start(request)`: builds
  the run manifest (`_build_run_manifest`, invoked at line 773), persists,
  admits through the shared queue caps, submits to the pool. A monitor run is
  just another `start()` call — no new admission surface.
- `runner.py:1495-1511` — `compare_runs(baseline_id, candidate_id)` returns
  a typed response with `comparable: bool` + `reason_codes` when manifests
  don't match (the codes are enumerated at `models.py:182-196`). This is the
  ready-made baseline matcher: the monitor needs "latest run whose manifest
  matches the candidate's," which the reason codes express directly.
- `runner.py:915-953` — `list_history()` returns runs sorted by
  `started_at` (newest first, capped at 50) — the baseline search space.
- `runner.py:66-73` — `RUN_MANIFEST_VERSION`, `RESPONSE_SEMANTICS_VERSION`,
  etc. — the version pins that make cross-version comparisons impossible.
- `backend/app/models.py:157-179` — `RunManifest` fields; `models.py:96-103`
  (`COMPARISON_METRIC_KEYS` in `runner.py`) — the six deltas available for
  thresholding: `median_ms`, `p95_ms`, `success_rate`, `failure_rate`,
  `blocking_efficacy`, `score_total`.
- `backend/app/cli.py:92-129` — the app's launch lifecycle: `main()` runs the
  uvicorn server in a daemon thread for GUI/headless modes. A scheduler needs
  a home in this lifecycle (or in the FastAPI app lifespan) — the spike must
  decide and specify.
- `frontend/src/hooks/useRunComparison.ts` — the existing compare UX
  (baseline/candidate selection, `selectPair`); `useRunHistory.ts` + `api.ts`
  (`getBenchmarkHistory`) — the history surface a monitor panel would reuse.
  The spike's UI section must reference these, not invent a parallel pattern.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat 087e5ff..HEAD -- backend/app/runner.py backend/app/cli.py frontend/src/hooks/useRunComparison.ts frontend/src/hooks/useRunHistory.ts frontend/src/components/RunComparisonPanel.tsx frontend/src/components/RunHistoryPanel.tsx frontend/src/lib/api.ts` | exit 0 (empty or only expected merged-plan context) |
| Spike tests | `cd backend && . .venv/bin/activate && pytest tests/test_monitor_spike.py -q` | all pass |
| Full gate   | `make backend-check`     | exit 0 |
| Doc presence | `test -f docs/MONITORING_MODE.md && echo present` | prints `present` |

## Scope

**In scope** (the only files you should create/modify):
- `docs/MONITORING_MODE.md` (new) — the design + decision record
- `backend/tests/watch_scheduler_spike.py` (new) — the spike prototype
  (scheduler + fake-clock + embedded fixture runs)
- `backend/tests/test_monitor_spike.py` (new) — the spike's executable
  validation

**Spike-code placement note**: the prototype lives in `backend/tests/` as a
plain module (no `tests/__init__.py` exists, so pytest's default import mode
makes sibling imports work — the existing tests do `from app.main import ...`
directly). It is imported by `test_monitor_spike.py` with a plain
`import watch_scheduler_spike`. The repo's tooling gates treat `tests/` the
right way automatically: mypy is scoped to `files = ["app"]`
(`pyproject.toml:70-72`), bandit excludes `tests` (`pyproject.toml:82-83`),
and ruff (`check .` from `backend/`) covers it — so the spike module must
stay ruff-clean, but never write `sys.path` hacks or dunder imports that
ruff flags (E402).

**Out of scope** (do NOT touch, even though they look related):
- Any production code: `backend/app/*`, `frontend/src/*` — this plan
  produces a design and a disposable prototype only.
- Plan 019/020 files — if they landed, their APIs may be referenced in the
  design (CSV columns for monitor exports; CLI as a cron alternative), but
  nothing here may depend on them at runtime.
- Actual scheduling of real DNS traffic — the spike runs on recorded
  fixtures; no live queries, no cron.

## Git workflow

- Branch: `plan/021-monitoring-mode-design-spike`
- Commits: conventional (`docs(monitoring): ...`, `test(monitoring): ...`).
  The merge commit on main is `merge: plan 021 — monitoring mode design spike`.
- The spike prototype in `backend/tests/` is evidence for the review: the
  design doc is the deliverable. Unless the reviewer explicitly asks to keep
  the spike, delete `backend/tests/watch_scheduler_spike.py` before merge
  (after the design is approved) — the doc captures the findings.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Investigate and record the design constraints

Read and summarize in the design doc (with file:line evidence):
1. Manifest equality surface: which `RunManifest` fields must match for a
   monitor baseline (the `COMPARISON_REASON_ORDER` enumeration, `runner.py:79-94`).
2. Where a scheduler thread can live: `cli.py`'s `main()` launch paths
   (headless/browser/native all run uvicorn in-process; a daemon thread
   started next to the server) vs. a FastAPI lifespan — record the trade-off.
3. Queue admission interplay: monitor runs go through the same
   `max_concurrent_jobs + max_queued_jobs` caps (`runner.py:799-800`) — decide
   and record whether a monitor run is skipped (not queued) when capacity is
   full, and how a manual user run interacts with an active watch.
4. Alert surface options, local-first constraint: an in-app endpoint + banner
   (reuse the existing `useRunHistory`/`useRunComparison` UX patterns) vs. the
   Web Notification API — record whether WebKitGTK (`cli.py:15-19`) supports
   it and whether browser mode does; no external channels without a new egress
   decision per `docs/REGION_TARGETING.md`.
5. Watch configuration persistence: runs dir (`runner.py:106-110` —
   `DNS_SPEED_LAB_RUNS_DIR` / `user_data_path("dnspect", "DNSpect") / "runs"`)
   vs. a new sibling `watch/` directory — record the choice and the schema.

**Verify**: `docs/MONITORING_MODE.md` contains a "Constraints" section with
all five items and file:line evidence. `test -f docs/MONITORING_MODE.md` → present.

### Step 2: Define the API and the decision list in the doc

In `docs/MONITORING_MODE.md`, specify (design-level, no code merged):
1. **Watch config model** — fields: `target_snapshot` (reuse the
   `TargetSnapshot` shape, `models.py:39-55`), `protocol`, `scoring_profile`,
   `mode`, `runs`, `timeout_sec`, `interval_min`, `thresholds` (per
   `COMPARISON_METRIC_KEYS`: relative delta %, e.g. `median_ms: 25`,
   `failure_rate: 5` as absolute points). Note that `queries` are pinned by
   the default query list unless specified — a watch must fix its query plan
   so manifests match across runs.
2. **Scheduler loop** — pseudocode: every `interval_min`, if the previous
   watch run has terminated, `start()` a run from the watch config; on
   `done`, find the newest history entry whose manifest equals the new run's
   manifest (express this as `compare_runs` reason-code checks); compute
   deltas; evaluate thresholds; record an alert event. Idempotent
   (no double-start), skip on capacity full, monotonic `last_sample_at`
   semantics preserved.
3. **API sketch** — routes/hook names: e.g. backend `GET/POST
   /api/watch`, `GET /api/watch/status`, frontend `useWatch` hook +
   banner/panel reusing `RunHistoryPanel` patterns; i18n key group
   `watch.*` in all three languages (ES source of truth per
   `frontend/src/lib/i18n-translations.ts`).
4. **Decision list** (explicitly unanswered, for the maintainer):
   - v1 scope: in-app watch (runs while the app is open) vs. background
     daemon across app restarts;
   - default thresholds and whether they are per-goal;
   - alert channel: in-app banner only vs. OS notifications;
   - whether a monitor run is eligible for ranking/recommendation (it
     shouldn't pollute the user-facing history by default — record the
     recommendation and the manifest alternative);
   - interplay with the DoQ spike (plan 022): watch protocols.

**Verify**: the doc has an "API sketch" and a "Decisions for the maintainer"
section, each bullet present (grep the doc for the section headings).

### Step 3: Spike — `backend/tests/watch_scheduler_spike.py`

Implement, in `backend/tests/watch_scheduler_spike.py`, a deterministic
prototype (ruff-clean — `make backend-check` runs `ruff check .` over
`backend/`, which includes `tests/`; mypy is scoped to `app` only and bandit
excludes `tests`):

- `WatchConfig` dataclass (fields per Step 2, with `interval_min` and
  `thresholds`).
- `SchedulerClock` protocol (`.now()` / `sleep()`) so the loop is testable
  with a fake clock — no real sleeping in tests.
- `WatchScheduler` with `tick()` (one iteration): given a fake runner facade
  (`start()`, `get()`, `list_history()`, `compare_runs()` — mirror the
  `BenchmarkManager` method names exactly so the future implementation maps
  1:1), the scheduler: skips when a run is active or capacity is full;
  starts a run; on done, picks the baseline = newest `list_history` entry
  whose manifest equals the new run's manifest (implement equality by
  comparing the `RunManifest` fields listed in `models.py:157-179`; when
  none matches, emit a `no_comparable_baseline` alert event with the reason
  codes); computes deltas; evaluates thresholds; returns alert events.
- Module-level fixture data: 3 recorded run dicts — two manifest-identical
  done runs with realistic stats (copy the stats shape from
  `tests/test_export_csv.py:34-58`), one with a different manifest (e.g.
  changed `runs`). Hand-authored, deterministic, embedded in the module.

**Verify**: `cd backend && . .venv/bin/activate && python -c "import sys; sys.path.insert(0, 'tests'); import watch_scheduler_spike; print('ok')"` → prints `ok`.

### Step 4: Spike tests — `backend/tests/test_monitor_spike.py`

Unit tests on `WatchScheduler` with a fake clock and a fake runner facade
(no real DNS, no real sleeps). Import the prototype with a plain
`import watch_scheduler_spike` (works because pytest runs from `backend/`
with `pythonpath = ["."]` in `pyproject.toml:48-50`, and `tests/` has no
`__init__.py`, so pytest inserts the test-file directory on `sys.path` —
the same mechanism the existing tests rely on for `from app.main import ...`):

1. `test_tick_skips_when_run_active`
2. `test_tick_starts_run_when_idle_and_capacity_available`
3. `test_tick_skips_when_capacity_full`
4. `test_tick_on_done_finds_manifest_matching_baseline` (uses fixture pair)
5. `test_tick_no_matching_baseline_emits_no_comparable_event` (uses the
   mismatched fixture)
6. `test_tick_threshold_crossing_emits_alert` (baseline vs. candidate with
   median +40% > threshold 25)
7. `test_tick_no_threshold_crossing_emits_no_alert`
8. `test_tick_idempotent_no_double_start`

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_monitor_spike.py -q` → 8 tests pass.

### Step 5: Record the spike outcome and close the doc

Update `docs/MONITORING_MODE.md` with a "Spike results" section: what the
prototype validated, the exact `BenchmarkManager` methods the build plan will
use, any API sketch revisions, and the finalized decision list for the
maintainer. Then run the full gate.

**Verify**: `make backend-check` → exit 0. Doc sections
`Constraints`, `API sketch`, `Spike results`, `Decisions for the maintainer`
all present (`grep -c` each heading ≥ 1).

## Test plan

- New tests in `backend/tests/test_monitor_spike.py` (Step 4) — deterministic,
  no network, no real timers.
- Structural pattern to follow: `backend/tests/test_comparisons.py` /
  `test_export_csv.py` (fixture dicts, no live queries).
- `make backend-check` must pass end to end.

## Done criteria

ALL must hold:

- [ ] `docs/MONITORING_MODE.md` exists with the four required sections
- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_monitor_spike.py -q` — 8 tests pass
- [ ] `make backend-check` exits 0
- [ ] `grep -rn "monitor\|watch" backend/app/ frontend/src/` returns no matches (the spike lives only in `backend/tests/` + `docs/`; the repo's pre-existing `schedule` matches at `runner.py:167-180` are expected)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 021 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `BenchmarkManager` method surface (`start`, `get`, `list_history`,
  `compare_runs`) or the `RunManifest` field set at `models.py:157-179`
  doesn't match the excerpts.
- WebKitGTK Notification API support cannot be determined (record it as
  "unknown — verify in the build plan" in the doc and continue; do not
  stall the whole spike on it).
- A step's verification fails twice after a reasonable fix attempt.
- The design appears to require an egress-policy change (any alert channel
  that sends data off-device) — that is a maintainer decision, not a spike
  decision; STOP and report.

## Maintenance notes

- This spike's decisions gate the future build plan: do not let the build
  plan re-open decided questions unless new evidence appears.
- The `SchedulerClock`/facade split in the spike is the seam a future plan
  replaces with real `BenchmarkManager` calls — keep the method names in the
  facade identical to the manager's so the replacement is mechanical.
- Alert events should respect the repo's no-telemetry contract: they are
  local state, never transmitted.
- When the DoQ spike (plan 022) lands, revisit "watch protocols" — a watch
  over DoQ should reuse the protocol-comparison eligibility machinery rather
  than the single-protocol path.
