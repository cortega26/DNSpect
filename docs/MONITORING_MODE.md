# Monitoring mode — design spike (plan 021)

Design and decision record for the README roadmap items 1–3: continuous
monitoring (background re-checking at intervals), scheduled/recurring
benchmarks, and alerting when a resolver degrades. Produced by the plan-021
design spike; the executable evidence lives in
`backend/tests/watch_scheduler_spike.py` + `backend/tests/test_monitor_spike.py`.

Scope of this document: decide the architecture, validate it against recorded
fixture runs, and leave the maintainer a short decision list. No production
code was written as part of this spike.

## Constraints

All evidence is from the repo at commit `087e5ff` (with plan 019/020 context
where noted).

### 1. Manifest equality surface — what a monitor baseline must match

`RunManifest` (`backend/app/models.py:157-179`) is the immutable measurement
contract: *"Two `done` runs are numerically comparable only when every field
here is exactly equal"* (docstring, `models.py:160-161`). The field set is:

`run_manifest_version`, `response_semantics_version`,
`scoring_semantics_version`, `scoring_profile`, `target_snapshot`,
`protocol`, `mode`, `runs`, `timeout_sec`,
`normal_query_schedule_version`, `normal_query_plan_sha256`,
`normal_query_count`, `blocking_query_plan_sha256`,
`blocking_query_count`, `diagnostic_policy_version`,
`provider_catalog_sha256`.

Mismatches map to the 14 reason codes enumerated in
`ComparisonReasonCode` (`models.py:182-196`) and ordered by
`COMPARISON_REASON_ORDER` (`backend/app/runner.py:79-94`).
`_manifest_mismatch_reason_codes` (`runner.py:207-263`) collapses the four
query-plan fields (schedule version, plan sha256, query counts, blocking
plan/count) into the single code `query_plan_mismatch` (`runner.py:236-242`).

Implication for a monitor: because equality is all-16-fields, a watch must
**pin its whole measurement contract** — same target snapshot, protocol,
scoring profile, mode, runs, timeout, and a fixed query plan. The query plan
hash is derived from the query schedule (`_build_run_manifest`,
`runner.py:167,179-180`), so the watch persists its query list and reuses it
verbatim on every cycle. A watch must also re-pin the default query list: the
plan's Step-2 note says "queries are pinned by the default query list unless
specified" — concretely, the first run's effective query list is stored in the
watch config so later runs produce byte-identical plans.

### 2. Where a scheduler thread can live

`cli.py` `main()` (`backend/app/cli.py:93-135`) launches uvicorn **in-process
in all three GUI modes**:

- headless: `_start_server` daemon thread (`cli.py:43-49`, called at
  `cli.py:108`), then a `while True` keep-alive (`cli.py:112-115`);
- native: `_start_native_gui` → `_start_server` (`cli.py:61`);
- browser: in-process `uvicorn.run` (`cli.py:88-90`).

The `dnspect run` subcommand (`cli.py:94-97`) is a one-shot CLI benchmark with
no server — it never hosts a scheduler.

Trade-off:

| Option | Pros | Cons |
|--------|------|------|
| **Daemon thread in the launcher** (`_start_server` + one call before `uvicorn.run` in browser mode) | Scheduler lifecycle lives with the process that owns it; test suites that create the FastAPI app never start a scheduler; gated by an env var | One call site per launch path (two sites total); not active for `dnspect run` one-shots (irrelevant — no server) |
| **FastAPI lifespan** | Central, host-agnostic (works for uvicorn, TestClient, packaged binary) | Couples a non-HTTP concern to the app lifecycle; every test `TestClient` context would boot the scheduler unless gated; dev `--reload` may double-start |

**Recorded decision**: daemon thread started from the launcher, gated by
`DNS_SPEED_LAB_WATCH_ENABLED` (default on). Two call sites: inside
`_start_server` (`cli.py:43-49`, covers headless + native) and before
`uvicorn.run` in `_start_browser_mode` (`cli.py:88-90`). The thread runs the
loop from Step "Scheduler loop" below and dies with the process.

### 3. Queue admission interplay

`BenchmarkManager.start` admits through the shared caps:
`running_count + queued_count >= max_concurrent_jobs + max_queued_jobs` raises
`ValueError("Capacidad de benchmark agotada…")` (`runner.py:799-800`; caps
defaults 2/5 at `runner.py:654-658`, env `DNS_SPEED_LAB_MAX_CONCURRENT_JOBS` /
`DNS_SPEED_LAB_MAX_QUEUED_JOBS`). Protocol comparisons count against the same
caps (`runner.py:791-798`).

**Recorded decision**: a monitor run is **skipped, never queued** when
capacity is full — the scheduler catches the `ValueError` from `start()` and
waits for the next interval. Manual user runs win the caps implicitly
(first-come); a watch never preempts or cancels anything. A manual run in
progress simply makes the watch skip that cycle.

### 4. Alert surface options, local-first constraint

- **In-app endpoint + banner** (recommended for v1): reuses the existing
  frontend patterns — `useRunHistory` polling
  (`frontend/src/hooks/useRunHistory.ts:11-48`) for the alert feed and
  `useRunComparison`/`selectPair`
  (`frontend/src/hooks/useRunComparison.ts:28-39`) for jumping from an alert
  to the baseline-vs-candidate comparison. No new UI machinery.
- **Web Notification API**: supported in the native GUI — WebKitGTK ships
  `WebKit2.Notification` and `WebKitNotificationPermissionRequest` since 2.8
  (WebKit2 API 4.1 = 2.42.x, the exact API version required at
  `cli.py:15-19`); the host must handle the permission request on the web
  context. Browser mode depends on the user's OS browser (Chromium/Firefox
  implement the API). Notifications are on-device UI — **no egress**.
- **Anything sending data off-device** (webhook/ntfy/email/push) is out of v1:
  the only permitted external request in the whole app today is the GeoIP
  `ipify` call per `docs/REGION_TARGETING.md:42-50`, and every other channel
  requires a new egress decision from the maintainer.

**Recorded decision**: v1 alerts are in-app only (backend event list + banner),
which satisfies the no-telemetry contract — alert events are local state,
never transmitted. OS notifications are a maintainer decision (decision list).

### 5. Watch configuration persistence

Runs live under `_resolve_runs_dir()` (`runner.py:106-110`):
`DNS_SPEED_LAB_RUNS_DIR` override, else `user_data_path("dnspect",
"DNSpect") / "runs"`. `list_history` (`runner.py:915-953`) globs that exact
directory, and `_persisted_run_path` (`runner.py:874-891`) enforces that
persisted-run identifiers are canonical UUIDv4 hex contained in it.

**Recorded decision**: watches live in a **sibling `watch/` directory** under
the same user-data root — `DNS_SPEED_LAB_WATCH_DIR` override, else
`user_data_path("dnspect", "DNSpect") / "watch"` — mirroring
`_resolve_runs_dir`. Rationale: a watch config is not a run; writing it into
the runs dir would pollute the history/compare surface and the manifest
contract. One JSON file per watch, `{watch_id}.json`, schema versioned
(`watch_schema_version: 1`). It stores the config (Step "Watch configuration
model") plus runtime state: `active_run_id`, `last_run_id`,
`last_evaluated_at`, `last_alert_at`, and a capped alert-event ring buffer
(50 events).

## Watch configuration model

```python
WatchConfig {
  watch_id: str
  target_snapshot: TargetSnapshot        # shape: models.py:39-55
  protocol: "udp" | "dot" | "doh"        # plus "tcp"/"quic" when plan 022 lands
  scoring_profile: BenchmarkGoal
  mode: "quick" | "standard" | "exhaustive"
  runs: int
  timeout_sec: float
  interval_min: int                      # >= 1; 30 default
  thresholds: {metric: float}            # keys from COMPARISON_METRIC_KEYS (runner.py:96-103)
  queries: list[str] | None = None       # None = pin the default query list at first run
}
```

Threshold units are fixed per metric (a per-key unit field adds configuration
without value):

- **relative percent delta** — `median_ms`, `p95_ms`, `blocking_efficacy`,
  `score_total` (e.g. `median_ms: 25` = alert when median degrades ≥ 25%);
- **absolute percentage points** — `success_rate`, `failure_rate`
  (e.g. `failure_rate: 5` = alert when failure rate rises ≥ 5 points;
  stored rate scale is 0–1 per `tests/test_export_csv.py:50-54`, so the
  effective bound is `0.05`).

Alert direction follows metric polarity: higher-is-better metrics
(`success_rate`, `blocking_efficacy`, `score_total`) alert on a decrease;
lower-is-better (`median_ms`, `p95_ms`, `failure_rate`) alert on an increase.

## Scheduler loop

One daemon thread, one `tick()` per `interval_min` (paced through
`SchedulerClock.now()`/`sleep()` so the loop is fully testable):

```text
loop:
  tick()                          # one iteration, returns alert events
  sleep(interval_min)

tick():
  if active_run_id is not None:
      run = runner.get(active_run_id)             # runner.py:893
      if run is None or run.status in {queued, running}: return []   # still active
      active_run_id = None
      if run.status != "done": return [watch_run_not_done event]
      return evaluate(run)
  try:
      run_id = runner.start(request_from(config))  # runner.py:753
  except ValueError:                               # capacity full, runner.py:799-800
      return []                                    # skip this cycle, never queue
  active_run_id = run_id
  return []

evaluate(candidate):
  # baseline = newest done history entry whose manifest equals candidate's
  # (manifest equality field-by-field over models.py:157-179; list_history
  # does not carry manifests, so each entry is loaded via runner.get)
  for entry in runner.list_history()["runs"]:      # runner.py:915, newest first
      skip candidate's own id; skip non-done
      if manifest_equals(runner.get(entry.id).manifest, candidate.manifest):
          baseline = entry.id; break
  if baseline is None:
      codes = runner.compare_runs(newest_done_entry, candidate).reason_codes  # runner.py:1495
      emit no_comparable_baseline event with codes
      return
  for resolver in common resolvers:
      for metric in COMPARISON_METRIC_KEYS:
          delta = metric_delta(baseline.stats, candidate.stats)
          if crosses_threshold(delta, metric, config.thresholds):
              emit threshold_alert event (resolver, metric, values, delta)
```

Semantics preserved: idempotent (one `active_run_id` guard — no double
start), skip on capacity full, and the run-level `last_sample_at` monotonic
behavior of `_update_progress` (`runner.py:1635-1636`) is untouched — watch
runs are ordinary `start()` calls.

## API sketch

Backend (design-level; routes are additive, no existing surface changes):

- `GET /api/watch` — list watches (config + status summary).
- `POST /api/watch` — create a watch (validates `target_snapshot`,
  thresholds, interval).
- `DELETE /api/watch/{watch_id}` — stop + remove a watch.
- `GET /api/watch/{watch_id}/status` — `active_run_id`, `last_run_id`,
  `last_evaluated_at`, `last_alert_at`, alert events (ring buffer).

Frontend:

- `useWatch` hook — polls the status endpoint, mirroring `useRunHistory`
  (`frontend/src/hooks/useRunHistory.ts`); `refresh`-style API.
- Watch panel + alert banner reusing `RunHistoryPanel`/`RunComparisonPanel`
  patterns (list rows, status pills, banner with `selectPair`-style drill-down
  into the baseline-vs-candidate comparison).
- i18n key group `watch.*` in all three languages; ES source of truth per
  `frontend/src/lib/i18n-translations.ts:3` (`esTranslations`).

## Spike results

The prototype (`backend/tests/watch_scheduler_spike.py`, validated by
`backend/tests/test_monitor_spike.py` — 8 tests, deterministic, no network,
no real timers) ran the full monitor cycle against hand-authored recorded
fixtures (stats shape from `tests/test_export_csv.py:41-73`).

**Validated end to end**: skip-while-active → start on idle → capacity-skip →
manifest-matching baseline selection → `no_comparable_baseline` with reason
codes → per-resolver threshold evaluation → alert events. Also validated:
idempotency (two ticks never double-start) and that a *newer but
manifest-mismatched* run is correctly skipped in baseline selection.

**Methods the build plan will use** (facade method names mirror these 1:1):

| Facade / spike | BenchmarkManager |
|---|---|
| `start()` | `start` — `runner.py:753-809` (capacity `ValueError` at `799-800`) |
| `get()` | `get` — `runner.py:893-908` |
| `list_history()` | `list_history` — `runner.py:915-953` |
| `compare_runs()` | `compare_runs` — `runner.py:1495-1511` |

**Findings that refined the sketch**:

1. `list_history` returns a **reduced view without manifests**
   (`runner.py:924-939`), so baseline finding needs `get()` per history entry
   (capped at 50, `runner.py:953`) to read manifests. Acceptable for v1
   (cold JSON reads); an optional optimization is a watch-scoped index of
   `run_id → watch_id` persisted in the `watch/` directory.
2. Capacity-full surfaces as `ValueError` from `start()` — the scheduler
   treats it as skip, not failure. No new admission surface is needed.
3. Rate thresholds must convert from percentage points to the stored 0–1
   scale (`failure_rate: 5` ⇒ effective bound `0.05`).
4. WebKitGTK Notification support is **confirmed** (see Constraints item 4),
   so OS notifications are a product decision, not a feasibility question.
5. Rate thresholds must convert from percentage points to the stored 0–1
   scale (`failure_rate: 5` ⇒ effective bound `0.05`).
6. Absolute-point rate deltas must evaluate from a **zero baseline**
   (failure rate 0 → 2 points is a real +2-point jump); only relative-percent
   metrics (`median_ms`, `p95_ms`, `blocking_efficacy`, `score_total`) need a
   nonzero baseline to divide. The spike test
   `test_tick_on_done_finds_manifest_matching_baseline` caught the naive
   zero-guard and it was corrected.
7. The API sketch held up: no structural revisions; the status endpoint just
   needs the alert ring buffer and last-evaluation timestamps.

## Decisions for the maintainer

1. **v1 scope**: in-app watch (runs while the app is open; state persisted so
   the watch resumes on next launch) vs. a background daemon across app
   restarts. Recommendation: in-app only for v1 — the persisted `watch/`
   directory already makes "resume on launch" free, and a background daemon
   adds packaging/tray complexity for little measurement value.
2. **Default thresholds** and whether they are per-goal (speed vs. privacy
   vs. blocking profiles weight different metrics). Recommendation: a single
   default set (`median_ms: 25`, `failure_rate: 5`, `success_rate: 5`,
   others off) applied uniformly, overridable per watch; per-goal defaults
   only if user testing shows false alerts.
3. **Alert channel**: in-app banner only vs. OS notifications (supported in
   native mode; WebKitGTK 4.1). Recommendation: in-app banner in v1, OS
   notifications in a follow-up — notification permission UX needs a product
   decision (auto-allow on first watch creation?).
4. **Do monitor runs enter user-facing history/ranking?** Recommendation: no
   — by default a watch run is a normal persisted run (it must be, for
   comparison), but the frontend tags it (watch origin + `active` badge) and
   excludes watch runs from the recommended-resolver panel and history unless
   the user filters them in. Manifest alternative if pollution is a problem
   later: a `watch` marker field on the request — but that changes the
   manifest contract, so only with a manifest-version bump.
5. **Interplay with the DoQ spike (plan 022)**: watch protocols are
   single-protocol v1 (`protocol` field). When plan 022 lands, a DoQ watch
   should reuse the protocol-comparison eligibility machinery
   (`ProtocolComparisonRequest`, `models.py:242-263`; `PROTOCOL_COMPARISON_MANIFEST_VERSION`,
   `runner.py:72-73`) rather than the single-protocol path — the monitor
   baseline matcher is protocol-agnostic because `protocol` is a manifest
   field, so no scheduler change is needed.
