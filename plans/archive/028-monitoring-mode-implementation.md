# Plan 028: Continuous monitoring mode — implementation build

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d775029..HEAD -- backend/app/models.py backend/app/runner.py backend/app/main.py backend/app/cli.py backend/app/watch.py backend/tests/test_watch.py frontend/src/lib/types.ts frontend/src/lib/api.ts frontend/src/lib/utils.ts frontend/src/lib/i18n-translations.ts frontend/src/hooks/useWatch.ts frontend/src/components/WatchPanel.tsx frontend/src/App.tsx frontend/src/components/RunHistoryPanel.tsx frontend/src/components/RecommendedResolverPanel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (implements the signed-off plan-021 decisions recorded in `docs/MONITORING_MODE.md`; reuses patterns from 024/026/027)
- **Category**: direction (build — README roadmap items 1-3: continuous monitoring, scheduled benchmarks, alerting)
- **Planned at**: commit `d775029`, 2026-08-11

## Why this matters

This is the product's stated endgame: continuous monitoring (background
re-checking at intervals), scheduled/recurring benchmarks, and alerting when
a resolver degrades. The plan-021 spike validated the design and its decisions
were signed off (see `plans/README.md` "Signed-off decisions" and
`docs/MONITORING_MODE.md` — read both before starting). Everything needed
already exists in the repo: manifest-gated comparisons, deterministic
ranking, atomic persistence (plan 024), the poll/abort hook patterns (plans
026/027). This plan turns the design into production code: a watch scheduler
in the backend process, CRUD + status routes, and a minimal frontend
(create watch from the current benchmark config, watch list, alert banner
that drills into the existing comparison panel). Monitoring runs are ordinary
`start()` calls, so admission caps, work budgets, determinism, and the
manifest contract all hold unchanged.

## Current state

- `docs/MONITORING_MODE.md` — the frozen design: `WatchConfig` fields
  (section "Watch configuration model"), scheduler loop pseudocode (section
  "Scheduler loop"), API sketch (`GET/POST /api/watch`, `DELETE
  /api/watch/{id}`, `GET /api/watch/{id}/status`), and the signed-off
  decisions. **This plan implements it**; where this plan adds a detail the
  doc leaves open (e.g. run-origin tagging), it is specified below and must
  be written back into the doc (Step 10).
- `backend/app/models.py` — `TargetSnapshot` (39-55), `BenchmarkGoal` (19-25),
  `BenchmarkProtocol` (27-31 + `doq` from plan 023), `BenchmarkMode` (13-17),
  `BenchmarkRequest` (95-136). `COMPARISON_METRIC_KEYS` lives in
  `runner.py:96-103`: `median_ms, p95_ms, success_rate, failure_rate,
  blocking_efficacy, score_total`.
- `backend/app/runner.py` — `BenchmarkManager.start(request)` (753-809)
  builds the config (716-751), admits through queue caps (799-800, raising
  `ValueError("Capacidad de benchmark agotada…")` when full), persists
  atomically (plan 024's `_persist_run_payload`), and returns the id.
  `get(id)` (893-908) and `list_history()` (915-953) read persisted runs
  (resilient since 024). `compare_runs` (1495-1511) gives manifest reason
  codes. `RunManifest` (models.py:157-179) has 16 equality fields —
  **unchanged by this plan**.
- `backend/app/cli.py:92-135` — `main()`: `run` dispatch (94-97), then
  `_start_server` (headless, called at ~108), `_start_native_gui` (native),
  `_start_browser_mode` (browser, `uvicorn.run` at ~127). The scheduler
  thread starts inside `_start_server` and before `uvicorn.run` in
  `_start_browser_mode` (design decision 2).
- `backend/app/main.py` — module-global `manager = BenchmarkManager()`
  (line 29); routes for providers/geoip/benchmarks/protocol-comparisons.
  `cli.py` already imports `from app.main import app` — the scheduler can
  take the same global manager.
- `frontend/src/lib/api.ts:98` — `RunHistoryEntry` (additive `origin` field
  goes here); watch endpoints follow the existing fetch/abort style
  (`getBenchmarkHistory` at 104, `getCapabilities` at 33).
- `frontend/src/App.tsx:227` — `useRunHistory(status?.id ?? null)` with
  `refreshRunHistory` (026's wiring); `RunHistoryPanel` rendered at 1553
  with `runs={history}`; `useRunComparison` (from `useRunComparison.ts`)
  provides `selectPair` for alert drill-down.
- `frontend/src/hooks/useRunHistory.ts` — the hook pattern 027 unit-tested;
  `useWatch` mirrors it.
- `frontend/src/lib/i18n-translations.ts` — ES source of truth; EN/PT
  mirrors; completeness is test-gated (`i18n.copy.test.ts`).
- `frontend/src/hooks/useBenchmarkSession.ts` — has the 026 retry/backoff;
  one deferred polish item (this plan folds it in): a transient poll error
  sets `error` and a later successful poll does NOT clear it
  (`setError` only fires on failures; see the catch at ~118-127).
- Existing test patterns to follow: `backend/tests/test_watch.py` modeled on
  `test_persistence_robustness.py` (temp-dir manager via `data_runs_dir` +
  monkeypatched `app.main.manager`) and the plan-021 spike tests
  (the spike file was deleted after review; its behaviors are specified in
  `docs/MONITORING_MODE.md` "Spike results"); frontend hook tests modeled on
  `frontend/src/hooks/useRunHistory.test.ts` (jsdom pragma, `vi.mock`,
  fake timers, I18nProvider wrapper).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Drift check | `git diff --stat d775029..HEAD -- <in-scope paths>` | exit 0 (empty or only expected merged-plan context) |
| Backend tests | `cd backend && . .venv/bin/activate && pytest tests/test_watch.py -q` | all pass |
| Full backend gate | `make backend-check`     | exit 0 |
| Frontend tests | `cd frontend && npx vitest run src/hooks/useWatch.test.ts src/lib/utils.test.ts` | all pass |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | all exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `backend/app/models.py` — `WatchConfigRequest`, watch request models
- `backend/app/watch.py` (new) — config persistence, `WatchScheduler`,
  threshold evaluation, alert ring buffer
- `backend/app/runner.py` — additive `origin` field on
  `BenchmarkRequest`/`BenchmarkState`/`as_response`/`list_history` entries
  (NOT in `RunManifest`); manager watch methods
- `backend/app/main.py` — `/api/watch` routes
- `backend/app/cli.py` — scheduler thread start (env-gated)
- `backend/tests/test_watch.py` (new)
- `frontend/src/lib/types.ts` — watch types, `RunHistoryEntry.origin`
- `frontend/src/lib/api.ts` — watch endpoints
- `frontend/src/lib/utils.ts` — `isWatchRun`, `latestUserRun` helpers
- `frontend/src/lib/utils.test.ts` — unit tests for the helpers
- `frontend/src/lib/i18n-translations.ts` — `watch.*` keys (ES/EN/PT)
- `frontend/src/hooks/useWatch.ts` (new) + `frontend/src/hooks/useWatch.test.ts` (new)
- `frontend/src/components/WatchPanel.tsx` (new)
- `frontend/src/App.tsx` — render `WatchPanel`, wire create-from-session,
  history/recommendation origin filtering
- `frontend/src/components/RunHistoryPanel.tsx` — origin badge + filter
- `frontend/src/components/RecommendedResolverPanel.tsx` — use `latestUserRun`
- `frontend/src/hooks/useBenchmarkSession.ts` — the error-clear polish (Step 9)
- `docs/MONITORING_MODE.md` — record the implementation-time decisions (Step 10)

**Out of scope** (do NOT touch, even though they look related):
- `RunManifest` and anything in the manifest contract (`RUN_MANIFEST_VERSION`,
  `_build_run_manifest`, `compare_runs` semantics) — the `origin` field is
  deliberately NOT in the manifest.
- The protocol-comparison machinery and DoQ comparison extension.
- `list_history`'s O(total-bytes) perf work (separate plan; the `origin`
  field lands in entries but no index/summary is added).
- OS notifications, background daemon across app restarts, egress of any
  kind (signed-off decisions: in-app banner v1, in-app watch only).
- `backend/app/cli_run.py` — the one-shot CLI never hosts the scheduler.
- Recharts/visualization changes.

## Git workflow

- Branch: `plan/028-monitoring-mode-implementation`
- Commit per step, conventional commits (`feat(watch): ...`,
  `test(watch): ...`). Merge commit on main:
  `merge: plan 028 — monitoring mode implementation`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Request models and the `origin` field

1. `backend/app/models.py` — add:
   ```python
   class WatchOrigin(str, Enum):
       watch = "watch"
   ```
   Add `origin: WatchOrigin | None = None` to `BenchmarkRequest` (after
   `target_snapshot`, line ~110). It is **not** part of the manifest —
   `_build_run_manifest` and the manifest models are untouched.
2. `backend/app/models.py` — add the watch request models (after the
   protocol-comparison models):
   ```python
   WATCH_METRIC_KEYS = ("median_ms", "p95_ms", "success_rate", "failure_rate", "blocking_efficacy", "score_total")

   class WatchConfigRequest(BaseModel):
       model_config = ConfigDict(extra="forbid")
       target_snapshot: TargetSnapshot
       protocol: BenchmarkProtocol = BenchmarkProtocol.udp
       scoring_profile: BenchmarkGoal = BenchmarkGoal.speed
       mode: BenchmarkMode = BenchmarkMode.quick
       runs: int | None = Field(default=None, ge=1, le=300)
       timeout_sec: float = Field(default=2.0, gt=0.1, le=10.0)
       interval_min: int = Field(default=30, ge=1)
       thresholds: dict[str, float] = Field(default_factory=dict)
       queries: list[str] | None = None

       @field_validator("thresholds")
       @classmethod
       def validate_thresholds(cls, value: dict[str, float]) -> dict[str, float]:
           unknown = set(value) - set(WATCH_METRIC_KEYS)
           if unknown:
               raise ValueError(f"Thresholds desconocidos: {sorted(unknown)}")
           if any(v < 0 for v in value.values()):
               raise ValueError("Los thresholds deben ser >= 0")
           return value

       @field_validator("queries")
       @classmethod
       def validate_queries(cls, values: list[str] | None) -> list[str] | None:
           return _normalize_queries(values, max_items=256)

       def effective_runs(self) -> int:
           if self.runs is not None:
               return min(max(self.runs, 1), 300)
           return MODE_DEFAULT_RUNS[self.mode]
   ```
   (`_normalize_queries`, `MODE_DEFAULT_RUNS` already exist in models.py.)
   Default thresholds applied at creation when `thresholds` is empty:
   `{"median_ms": 25.0, "failure_rate": 5.0, "success_rate": 5.0}`
   (signed-off decision).

**Verify**: `cd backend && . .venv/bin/activate && python -c "from app.models import WatchConfigRequest, WatchOrigin; w = WatchConfigRequest(target_snapshot={'resolver_ips': ['1.1.1.1'], 'selection_source': 'manual'}); assert w.thresholds == {'median_ms': 25.0, 'failure_rate': 5.0, 'success_rate': 5.0}; print('ok')"` → `ok` (implement the default-injection inside the model validator or in the create method — spec it in the create method if cleaner; the assertion above is the contract).

### Step 2: `backend/app/watch.py` — persistence and scheduler

Create `backend/app/watch.py` with:

1. **Watch dir resolution** (mirror `runner.py:106-110`):
   ```python
   def _resolve_watch_dir() -> Path:
       override = os.getenv("DNS_SPEED_LAB_WATCH_DIR")
       if override:
           return Path(override).expanduser().resolve()
       return user_data_path("dnspect", "DNSpect") / "watch"
   WATCH_DIR = _resolve_watch_dir()
   WATCH_SCHEMA_VERSION = 1
   ```
2. **`WatchStore`** — one JSON file per watch, `{watch_id}.json` in
   `WATCH_DIR`; schema `{"watch_schema_version": 1, "config": {...},
   "runtime": {"active_run_id": null, "last_run_id": null,
   "last_evaluated_at": null, "last_alert_at": null, "alert_events": []}}`.
   Persist with the atomic tmp+`os.replace` pattern from plan 024
   (`os.replace` is required; no plain `write_text`). Reads: widened
   `(OSError, ValueError)` + dict-root guards (plan 024 pattern). Methods:
   `list()`, `load(watch_id)`, `save(watch_id, data)`, `delete(watch_id)`
   (also unlinks the file). Validate `watch_id` with the same
   canonical-UUID-hex + containment rules as `_persisted_run_path`
   (runner.py:874-891 — reuse the approach, not the method).
3. **`WatchScheduler`** — production version of the spike:
   - `__init__(self, manager, watch_dir: Path | None = None, clock=None)` —
     `manager` is the `BenchmarkManager` (duck-typed for tests); `clock` is
     an injectable `now()/sleep()` pair defaulting to `time.monotonic`/`time.sleep`
     (the SchedulerClock seam from the design; keep method names 1:1 with
     `BenchmarkManager`).
   - `tick_all()` — for each persisted watch whose `interval_min` has
     elapsed since `last_tick_at` (tracked in-memory per watch), call
     `tick(watch)`. One watch per tick:
     1. If `runtime.active_run_id` set: `run = manager.get(id)`; if status in
        `{"queued", "running"}` return; clear `active_run_id`; if status !=
        `"done"`, emit a `watch_run_not_done` event and return; else evaluate.
     2. Else: `manager.start(BenchmarkRequest(...))` built from the watch
        config (origin=`WatchOrigin.watch`, target_snapshot from config,
        queries = config.queries or None — the FIRST run's effective query
        list is what the manifest pins, so the config's `queries` must be
        fixed at creation: if the request omits queries, the manager's
        `default_queries` are used on every run — which is stable — so
        passing None is safe and re-pins the same default list every cycle).
        On `ValueError` (capacity full) return silently — skip, never queue.
        Set `active_run_id`.
     3. `evaluate(watch, candidate)` — baseline = newest `list_history()`
        entry (skip candidate's own id, skip non-`done`; `origin == "watch"`
        entries are eligible — the previous cycle's run is the natural
        baseline) whose manifest equals the candidate's manifest (compare
        the 16 `RunManifest` fields field-by-field; each candidate entry
        needs `manager.get(entry.id)` since `list_history` omits manifests).
        If none matches: emit `no_comparable_baseline` with the reason codes
        from `manager.compare_runs(newest_done_id, candidate_id)`. Else, per
        resolver present in both runs, per `COMPARISON_METRIC_KEYS`:
        compute the delta and emit a `threshold_alert` when it crosses the
        threshold. Units per the design: relative % delta for
        `median_ms/p95_ms/blocking_efficacy/score_total`; absolute points on
        the 0-1 stored scale for `success_rate/failure_rate` (a config value
        of `5` means 5 points = bound `0.05`); polarity: higher-is-better
        alerts on decrease, lower-is-better on increase; a relative metric
        with a zero/absent baseline value never alerts (no division).
     4. Append events to `runtime.alert_events` (cap 50, drop oldest);
        update `last_evaluated_at`/`last_alert_at`; persist via the store.
   - `_run_loop()` — daemon thread entry: `while not stop_event.is_set():
     tick_all(); sleep(5)` — the 5s coarse loop checks per-watch due times
     (each watch's `interval_min` decides its own cadence).
   - `start()` / `stop()` — spawn/join a `threading.Thread(
     target=_run_loop, name="dnswatch", daemon=True)`; idempotent.
   - `create(config: WatchConfigRequest) -> str`, `delete(watch_id)`,
     `list_watches() -> list[dict]`, `get_status(watch_id) -> dict | None`
     — the manager-facing API (see Step 3).
   - Config → `BenchmarkRequest` mapping must pass `origin`; store the
     config's `queries` verbatim on create (None = default list pinned by
     the manager's defaults).

**Verify**: `cd backend && . .venv/bin/activate && python -c "import app.watch; print('ok')"` → `ok`.

### Step 3: Manager + routes wiring

1. `backend/app/runner.py` — additive `origin`:
   - `BenchmarkRequest.origin` (Step 1) flows through `_build_config` into
     `BenchmarkConfig` and `BenchmarkState` (add `origin: str | None = None`
     to both dataclasses); `as_response()` includes `"origin": self.origin`;
     `list_history` entries gain `"origin": data.get("origin")`. The manifest
     builder is untouched.
   - Add manager methods that delegate to a `self._watch_scheduler`
     (`WatchScheduler(self)` created lazily in `__init__`):
     `create_watch(request: WatchConfigRequest) -> str`,
     `delete_watch(watch_id)`, `list_watches()`, `get_watch_status(watch_id)`.
2. `backend/app/main.py` — routes (additive, existing surface unchanged):
   - `GET /api/watch` → `manager.list_watches()`
   - `POST /api/watch` → 400 on `ValueError` (config validation)
   - `DELETE /api/watch/{watch_id}` → 404 when absent
   - `GET /api/watch/{watch_id}/status` → 404 when absent
3. `backend/app/cli.py` — in `_start_server` and before `uvicorn.run` in
   `_start_browser_mode`, start the scheduler when the env gate is on:
   ```python
   def _start_watch_scheduler_if_enabled() -> None:
       if os.getenv("DNS_SPEED_LAB_WATCH_ENABLED", "1").strip().lower() in {"1", "true", "yes"}:
           from app.main import manager
           manager._watch_scheduler.start()
   ```
   (call it in both launch paths; the daemon thread dies with the process —
   no shutdown ceremony needed.)

**Verify**: `cd backend && . .venv/bin/activate && python -c "
from fastapi.testclient import TestClient
from app.main import app
r = TestClient(app).get('/api/watch')
assert r.status_code == 200 and r.json() == {'watches': []}
print('routes-ok')"` → `routes-ok`.

### Step 4: Backend tests — `backend/tests/test_watch.py`

Model on `test_persistence_robustness.py` (temp-dir manager:
`BenchmarkManager(data_runs_dir=tmp_path/"runs")`, monkeypatch
`app.main.manager` for the routes) and the spike behaviors from
`docs/MONITORING_MODE.md`. A `FakeClock` and a fake/drivable manager facade
(duck-typed: `start`, `get`, `list_history`, `compare_runs`) keep the
scheduler tests deterministic (no real sleeps — call `tick_all()` directly,
never the thread):

1. `test_watch_create_persists_and_lists` — create via POST; `GET /api/watch`
   shows it; the file exists in the watch dir with schema version 1.
2. `test_watch_create_rejects_bad_thresholds` — unknown metric key → 400;
   negative value → 400.
3. `test_watch_delete_removes_file_and_routes_404` — DELETE → 200; status →
   404; file gone.
4. `test_watch_start_skips_on_capacity_full` — facade `start` raises
   `ValueError`; `tick_all()` → no exception, no `active_run_id`, no event.
5. `test_watch_cycle_runs_evaluate_and_alerts` — facade serves a manifest-
   identical baseline + candidate (fixture dicts, stats shape from
   `test_export_csv.py`); first `tick_all()` starts the run, second (after
   `complete`) evaluates; median +40% > 25 → `threshold_alert` event with
   `baseline_id`, `run_id`, metric, values, delta, threshold.
6. `test_watch_no_matching_baseline_emits_no_comparable` — manifest-
   mismatched candidate → `no_comparable_baseline` with reason codes.
7. `test_watch_rate_threshold_uses_point_scale` — `failure_rate` threshold 5
   with baseline 0.02 → candidate 0.06 → alert (bound 0.05, not 5.0).
8. `test_watch_alert_ring_buffer_capped_at_50` — force 55 events; only the
   newest 50 persist.
9. `test_watch_run_is_tagged_origin_watch` — after a real (faked) cycle via
   the real manager + temp dirs, the persisted run's JSON and
   `list_history` entry carry `origin: "watch"`; the manifest does NOT
   contain an `origin` field.
10. `test_watch_status_shape` — status includes config, active_run_id,
    last_run_id, last_evaluated_at, last_alert_at, alert_events.
11. `test_watch_id_lookup_containment` — `../evil` style ids → 404, no disk
    access outside the watch dir.

**Verify**: `cd backend && . .venv/bin/activate && pytest tests/test_watch.py -q` → 11 tests pass.

### Step 5: Frontend types + API + helpers

1. `frontend/src/lib/types.ts` — `WatchConfigPayload`, `WatchStatus`,
   `WatchAlertEvent` interfaces matching the backend response shapes;
   `RunHistoryEntry` gains `origin?: 'watch' | null`.
2. `frontend/src/lib/api.ts` — `getWatches(signal?)`, `createWatch(payload)`,
   `deleteWatch(watchId)`, `getWatchStatus(watchId, signal?)` following the
   file's fetch/abort style.
3. `frontend/src/lib/utils.ts` — pure helpers:
   ```ts
   export function isWatchRun(entry: { origin?: string | null } | null | undefined): boolean
   export function latestUserRun(history: RunHistoryEntry[]): RunHistoryEntry | null
   ```
   `isWatchRun`: `entry?.origin === 'watch'`. `latestUserRun`: the newest
   (by `started_at`) non-watch done entry, else null.
4. `frontend/src/lib/utils.test.ts` — unit tests: `isWatchRun` true/false/
   null-safety; `latestUserRun` picks newest user run, skips watch runs,
   returns null when only watch runs exist.

**Verify**: `cd frontend && npx vitest run src/lib/utils.test.ts` → all pass.

### Step 6: `useWatch` hook + tests

`frontend/src/hooks/useWatch.ts` — mirror `useRunHistory.ts` exactly
(refresh/seq/abort/mounted pattern): `listWatches` on mount and after each
mutation; expose `{ watches, watchesLoading, refresh, create, remove }`.
`create`/`remove` call the api then `refresh()`.

`frontend/src/hooks/useWatch.test.ts` — model on `useRunHistory.test.ts`
(jsdom pragma, `vi.mock('@/lib/api')`, I18nProvider wrapper):
1. `lists watches on mount`
2. `create calls api and refreshes the list`
3. `remove calls api and refreshes`
4. `aborts in-flight list on unmount`
5. `refresh is stable across renders`

**Verify**: `cd frontend && npx vitest run src/hooks/useWatch.test.ts` → 5 tests pass.

### Step 7: `WatchPanel` component + i18n

1. `frontend/src/lib/i18n-translations.ts` — add a `watch.*` key group to
   `esTranslations` (source of truth) AND both mirrors (EN/PT), all three
   in the same commit (the copy test enforces parity). Keys (~20):
   `watch.title`, `watch.description`, `watch.enable`, `watch.interval`,
   `watch.intervalMinutes`, `watch.create`, `watch.delete`, `watch.deleteConfirm`,
   `watch.status.idle`, `watch.status.running`, `watch.status.evaluating`,
   `watch.lastRun`, `watch.lastEvaluated`, `watch.alerts`,
   `watch.alert.degraded`, `watch.alert.noBaseline`,
   `watch.empty`, `watch.hiddenFromHistory`, `watch.showWatchRuns`,
   `watch.error.create`, `watch.error.delete`.
2. `frontend/src/components/WatchPanel.tsx` — props:
   `{ doqAvailable, onCompare(baselineId, candidateId), currentSession }`:
   - create form: interval input (minutes, default 30), thresholds shown
     read-only with defaults, "Create watch from current configuration"
     button (builds the payload from `currentSession` — target snapshot,
     protocol, goal, mode, runs, timeout — the same shape the comparison
     preflight builds in `App.tsx:361-398`), disabled while a benchmark runs
     or when no resolvers are selected;
   - watch list rows: name/id, protocol badge, interval, last status pill
     (idle/running/evaluating via `active_run_id` + `last_evaluated_at`),
     alert count, delete button;
   - alert banner: for each alert event, a row `[metric] resolver: baseline
     value → candidate value (delta %)` with a "compare" button calling
     `onCompare(baseline_id, run_id)`; `no_comparable_baseline` events
     render as an info row.
   Follow the panel conventions of `RunHistoryPanel.tsx` (class names,
   badges, i18n via `useI18n`).
3. `frontend/src/App.tsx` — render `WatchPanel` in the dashboard section;
   wire `onCompare` to `useRunComparison`'s `selectPair`; pass the current
   session config; pass `doqAvailable` (already in state from 023).

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0; the
i18n copy test passes: `cd frontend && npx vitest run src/lib/i18n.copy.test.ts` → pass.

### Step 8: Origin filtering in history + recommendation

1. `frontend/src/components/RunHistoryPanel.tsx` — hide `origin === 'watch'`
   entries by default; add a "show watch runs" toggle (key
   `watch.showWatchRuns`) that reveals them with a small "watch" badge;
   use `isWatchRun`.
2. `frontend/src/components/RecommendedResolverPanel.tsx` — consume the
   dashboard's run through `latestUserRun(history)` instead of the raw
   last-run (check the current prop source in `App.tsx` and thread the
   helper there — App selects the run for the recommendation; the panel just
   renders it).
3. `frontend/src/App.tsx` — derive `recommendationRun = latestUserRun(history)`
   and pass it down; keep behavior identical when no watch runs exist.

**Verify**: `cd frontend && npm run typecheck && npm run lint` → exit 0; `npx vitest run src/lib/utils.test.ts` still passes.

### Step 9: Poll-error-clear polish (deferred item from 027)

In `frontend/src/hooks/useBenchmarkSession.ts` — in `pollOnce`'s success path
(after `setStatus(next)`), clear the transient error when a poll succeeds
after a retry: `setError(null)` guarded so it only runs when a retry actually
happened (e.g. clear unconditionally on success — the error is only set by
poll failures; verify no other consumer sets `error` in this hook that a
successful poll should preserve — if `error` is also set by `start()`/
`selectRun()` failures, clear only when it was set by a poll retry: track a
`pollFailedRef` boolean, set true in the catch, and clear `error` +
`pollFailedRef` on the next successful poll only if `pollFailedRef` is true).

**Verify**: `cd frontend && npm run typecheck && npm run lint && npx vitest run src/hooks/useBenchmarkSession.test.ts` → all pass.

### Step 10: Record implementation decisions in `docs/MONITORING_MODE.md`

Append a short "Implementation notes (plan 028)" section recording the
decisions this plan made where the design left detail open:
- run-origin tagging: additive `origin` field on request/state/response/
  history (NOT in the manifest — manifest equality untouched);
- baseline selection may reuse previous watch runs;
- coarse scheduler loop (5s) with per-watch `interval_min` due times;
- default thresholds applied at creation;
- env gate `DNS_SPEED_LAB_WATCH_ENABLED` (default on, harmless with no
  watches).

**Verify**: `grep -c "Implementation notes" docs/MONITORING_MODE.md` ≥ 1.

### Step 11: Full gates

**Verify**: `make backend-check` → exit 0; `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` → all exit 0; `git status` shows only in-scope files.

## Test plan

- `backend/tests/test_watch.py` — 11 cases (Step 4): CRUD, validation,
  capacity-skip, full cycle + alerts, no-baseline, point-scale thresholds,
  ring buffer cap, origin tagging, status shape, id containment.
- `frontend/src/hooks/useWatch.test.ts` — 5 cases (Step 6), modeled on
  `useRunHistory.test.ts` (the 027 pattern).
- `frontend/src/lib/utils.test.ts` — `isWatchRun`/`latestUserRun` unit tests.
- The existing suites must stay green: `make backend-check`, `npm test`
  (including the i18n copy test which enforces ES/EN/PT key parity), and the
  Playwright e2e specs (unchanged — but note: e2e mock fixtures for
  `/api/watch` are NOT needed; the panel mounts with empty watch state and
  the e2e assertions on history/ranking must still pass with origin-less
  entries — verify by running the e2e suite locally if the environment
  allows, otherwise flag it in NOTES).

## Done criteria

ALL must hold:

- [ ] `cd backend && . .venv/bin/activate && pytest tests/test_watch.py -q` — 11 tests pass
- [ ] `make backend-check` exits 0
- [ ] `cd frontend && npx vitest run src/hooks/useWatch.test.ts src/lib/utils.test.ts` — all pass
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] `grep -rn "origin" backend/app/runner.py` matches the state/response/history additions; `grep -rn "origin" backend/app/runner.py | grep -c manifest` == 0 (manifest untouched)
- [ ] `grep -rn "DNS_SPEED_LAB_WATCH_ENABLED" backend/app/cli.py` matches
- [ ] `grep -rn "'watch\." frontend/src/lib/i18n-translations.ts` matches ≥ 3 (ES/EN/PT groups)
- [ ] `grep -rn "isWatchRun\|latestUserRun" frontend/src/App.tsx frontend/src/components/RunHistoryPanel.tsx frontend/src/components/RecommendedResolverPanel.tsx` matches each file
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 028 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any code at the "Current state" locations doesn't match the excerpts.
- A design detail in `docs/MONITORING_MODE.md` contradicts this plan's
  specification (read the doc's sections first) — report the conflict
  instead of picking a side.
- The `origin` field turns out to be REQUIRED for manifest equality or
  `compare_runs` correctness (it must not be) — STOP, do not add it to the
  manifest.
- The e2e suite (`frontend/tests/e2e/*.spec.ts`) breaks with origin-less
  fixtures — the panel must not change behavior when `origin` is absent;
  if it does, fix the component, not the e2e specs; if the fix is not
  component-local, STOP.
- A step's verification fails twice after a reasonable fix attempt.
- The task appears to require touching the manifest contract, the
  protocol-comparison machinery, `cli_run.py`, or any egress path to proceed.

## Maintenance notes

- The scheduler thread dies with the process (daemon) — that is the
  signed-off v1 scope (in-app watch). A future "background daemon across
  restarts" plan builds on `WatchStore` + the persisted runtime state; the
  store is the seam.
- The `origin` field is the tag the frontend uses; keep it out of the
  manifest FOREVER (a watch run must stay comparable to a manual run with
  the same measured set — that is why the manifest must not know about it).
- Watch runs consume the same queue caps as manual runs; with many watches
  and small intervals, a watch can starve manual runs — the capacity-skip
  rule prevents queue buildup but not repeated preemption; revisit
  priorities only if user testing shows it.
- The alert event shape (`baseline_id`, `run_id`, metric, values, delta,
  threshold) is the contract the future OS-notification channel (deferred
  decision) will consume — keep it stable.
- `WatchConfigRequest.queries=None` re-pins the manager's default query list
  every cycle; if the default list file (`data/queries.txt`) changes between
  cycles, manifests mismatch and the cycle emits `no_comparable_baseline`
  instead of a false alert — correct behavior, worth knowing.
- Plan 021's remaining roadmap tail ("scheduled benchmarks with persistent
  history") is delivered by this plan's create/watch/interval mechanics; the
  "configurable alerting" item is delivered by thresholds + banner.
