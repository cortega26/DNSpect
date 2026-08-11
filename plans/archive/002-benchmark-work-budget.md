# Plan 002: Bound aggregate benchmark work and report every scheduled DNS attempt

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report it; do not improvise. A coordinating reviewer maintains `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- backend/app/runner.py backend/tests/test_manager_lifecycle.py backend/tests/test_progress_last_sample.py README.md`
> If any in-scope file changed since this plan was written, compare the Current state excerpts with live code. A material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-dns-response-semantics.md`
- **Category**: perf
- **Planned at**: commit `e09fd2d`, 2026-08-10
- **Merged**: `6a2dba5`, 2026-08-11

## Why this matters

The queue is bounded by job count, but a single valid benchmark can still monopolize a worker for days. With the current limits, every resolver receives normal benchmark queries, 25 blocking-domain probes, and two diagnostics; the maximum request is 83,712 sequential attempts. The reported progress omits the two diagnostics per resolver, so it reaches 100% before the job actually finishes. This plan preserves local/private-resolver diagnostics and deterministic scoring while adding an explicit aggregate-work guardrail and exact progress accounting.

## Current state

- `backend/app/models.py` — per-field Pydantic workload limits.
- `backend/app/runner.py` — request expansion, bounded worker queue, benchmark execution, and progress updates.
- `data/blocking_domains.txt` — 25 active blocking probe domains loaded at manager construction.
- `backend/tests/test_manager_lifecycle.py` — temporary-manager and queue-limit test convention.
- `backend/tests/test_progress_last_sample.py` — progress-state assertion convention.
- `README.md` — documents the current queue and workload guarantees.

Current limits and scheduling facts:

```python
# backend/app/models.py:70-92
runs: Optional[int] = Field(default=None, ge=1, le=300)
timeout_sec: float = Field(default=2.0, gt=0.1, le=10.0)
...
return _normalize_resolvers(values, max_items=256)
return _normalize_queries(values, max_items=256)

# backend/app/runner.py:286-304
blocking_total = len(config.resolvers) * len(self.blocking_test_queries)
...
progress_total = len(config.resolvers) * config.runs + blocking_total
...
if running_count + queued_count >= (self.max_concurrent_jobs + self.max_queued_jobs):
    raise ValueError("Capacidad de benchmark agotada...")
```

`data/blocking_domains.txt:11-44` contains 25 non-comment domains. For each resolver, `_run` performs `config.runs` normal attempts (`backend/app/runner.py:626-645`), every blocking attempt (`677-693`), then one NXDOMAIN-hijack probe and one DNSSEC probe (`700-732`). Only the first two groups increment progress. The executor defaults to two workers (`backend/app/runner.py:217-233`), and a `drill` attempt permits `timeout_sec + 0.6` seconds (`747-755`). Thus the present maximum is `256 × (300 + 25 + 2) = 83,712` attempts and approximately 10.27 days on a timed-out drill worker.

Conventions to retain:

- `BenchmarkManager._build_config()` is the shared normalization point before `start()` puts work into the executor (`backend/app/runner.py:253-281`). Reject budget violations there as `ValueError`, so the existing endpoint converts them to HTTP 400 (`backend/app/main.py:96-102`).
- Queue admission itself is correct and lock-protected; do not remove or weaken it.
- Tests instantiate `BenchmarkManager(..., data_runs_dir=tmp_path / "runs")`, monkeypatch query execution, and poll through `_wait_terminal` (`backend/tests/test_manager_lifecycle.py:12-85`).
- The progress timestamp must remain monotonic (`backend/app/runner.py:475-492` and `backend/tests/test_progress_last_sample.py:7-72`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install backend tooling (only if `.venv` is absent) | `make backend-install` | exit 0 and `backend/.venv` exists |
| Focused budget/progress tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_manager_lifecycle.py tests/test_progress_last_sample.py` | exit 0; all selected tests pass |
| API regression tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_probe.py tests/test_validation.py` | exit 0; existing API validation behavior passes |
| Full backend quality gate | `make backend-check` | exit 0; Ruff, format check, mypy, Bandit, and pytest all pass |
| Scope review | `git diff --check && git status --short` | no whitespace errors; only in-scope files changed |

## Scope

**In scope** (the only files to modify):

- `backend/app/runner.py`
- `backend/tests/test_manager_lifecycle.py`
- `backend/tests/test_progress_last_sample.py`
- `README.md`

**Out of scope**:

- `backend/app/models.py` field maxima; retain the documented Pydantic limits and add aggregate validation after configuration expansion.
- `backend/app/main.py` route shapes and synchronous `/api/probe` behavior. The new manager `ValueError` must flow through the existing 400 mapping; do not add a new endpoint.
- Cancellation, executor shutdown/lifespan wiring, or a cancellation API.
- DNS response semantics, score weights, provider data, and private/internal resolver support.
- Frontend ETA presentation; this plan only makes the backend’s `progress.current` and `progress.total` truthful.

## Git workflow

- Branch: `advisor/002-benchmark-work-budget`.
- Commit the implementation, tests, and README documentation together using the observed conventional style, for example: `fix: bound aggregate benchmark work`.
- Do not push, open a PR, or edit `plans/README.md` unless the operator explicitly asks.

## Steps

### Step 1: Define one canonical, reusable work-estimate contract

In `backend/app/runner.py`, introduce `FIXED_DIAGNOSTIC_ATTEMPTS = 2` for the
NXDOMAIN-hijack and DNSSEC probes, a small immutable `BenchmarkWorkEstimate`
value object, and this exact private manager method:

```python
def _estimate_benchmark_work(
    self,
    *,
    resolver_count: int,
    runs: int,
    timeout_sec: float,
    protocol_count: int = 1,
) -> BenchmarkWorkEstimate:
    ...
```

It returns normal attempts per resolver (`runs`), blocking attempts per
resolver (`len(self.blocking_test_queries)`), diagnostic attempts per resolver
(`FIXED_DIAGNOSTIC_ATTEMPTS`), `total_attempts` equal to their sum times
`resolver_count * protocol_count`, and `estimated_duration_sec` equal to
`total_attempts * (timeout_sec + 0.6)`. Reject non-positive counts before this
private helper is called; it is a normalized-work calculation, not public
request validation.

For an ordinary benchmark, call it with `resolver_count=len(config.resolvers)`
and `protocol_count=1`. Use its `total_attempts` for
`BenchmarkState.progress_total` and both estimate fields for aggregate
admission. Plan 018 must call this same method with its common-target count
and requested-protocol count; do not reproduce the arithmetic there. Do not
count `ProbeRequest` work in this benchmark state; it has a distinct
synchronous flow.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_progress_last_sample.py` → exit 0 before adding the new whole-run progress test in Step 3.

### Step 2: Add deterministic aggregate budget configuration and admission

Extend `BenchmarkManager.__init__` with two positive, injectable limits and corresponding documented environment defaults:

- `DNS_SPEED_LAB_MAX_QUERY_ATTEMPTS`, default **10000**;
- `DNS_SPEED_LAB_MAX_ESTIMATED_DURATION_SEC`, default **14400** (four hours).

Use the existing positive-integer environment parsing convention. For tests, accept explicit positive constructor overrides; do not mutate process environment in tests.

After `_build_config()` has selected supported resolvers and before `start()` creates state or persists anything, reject a job when either:

1. total attempts exceeds `max_query_attempts`; or
2. conservative estimated duration exceeds `max_estimated_duration_sec`.

Read conservative duration from `BenchmarkWorkEstimate.estimated_duration_sec`,
which uses `timeout_sec + 0.6` to match the existing drill subprocess
allowance. The default values deliberately preserve the built-in 50-provider
exhaustive workload (approximately 5,350 attempts, approximately 13,910
seconds at the default two-second timeout plus drill allowance) while rejecting
the current extreme request. Error messages must be concise Spanish
`ValueError`s that state which aggregate limit was exceeded and guide the
operator to reduce resolver count/runs/timeout or configure the relevant
environment variable.

Do not use wall-clock measurement, randomness, or input order in the admission decision; the same normalized request and configuration must always be accepted or rejected identically.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_manager_lifecycle.py` → exit 0 after Step 4 adds explicit acceptance/rejection tests.

### Step 3: Make progress include diagnostic attempts

In `_run`, call `_update_progress()` exactly once after the NXDOMAIN-hijack measurement and exactly once after the DNSSEC measurement. Preserve the current resolver and monotonic timestamp behavior; diagnostic samples do not need to contribute latency to `observed_latency_total_ms`.

The final state of every completed benchmark must satisfy `progress.current == progress.total`, including when blocking domains are empty. Do not increment progress in exception handling twice; a failed measurement is still one completed attempt.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_progress_last_sample.py tests/test_manager_lifecycle.py` → exit 0 with a new completed-run assertion for exact counts.

### Step 4: Add focused, isolated regression tests

Use the temporary-manager pattern from `backend/tests/test_manager_lifecycle.py` and avoid live DNS:

- Add a test with a manager configured with a low `max_query_attempts`, a known short blocking list, and a request whose exact count is one over the limit. Assert `manager.start()` raises `ValueError` before a worker is submitted or a run file is created.
- Add a boundary test with an exact-at-limit request that starts and reaches `done` using a monkeypatched fast measurement function.
- Add a duration-budget test with a deliberately low injected duration limit and otherwise allowed attempt count. Assert the duration rejection is deterministic and distinct from the attempt-count rejection.
- Add a completed-run progress test: use one resolver, two normal runs, one blocking domain, and the two diagnostics. Count fake measurements and assert `progress.total == progress.current == 5` and the measurement count is five.
- Retain existing queue-capacity tests unchanged; they prove a separate guardrail.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_manager_lifecycle.py tests/test_progress_last_sample.py` → all existing and new tests pass without timing-sensitive sleeps beyond the existing terminal polling helper.

### Step 5: Document the aggregate controls without overstating guarantees

Update `README.md` near the existing runtime queue controls and input-validation limits to document the two new environment variables, their defaults, and that they cap aggregate scheduled benchmark work after resolver/protocol expansion. Keep the privacy/security statement accurate: private resolver diagnostics remain supported, and this is a local resource guardrail rather than an SSRF control.

Do not claim a strict real-world completion-time guarantee; the duration calculation is an admission estimate based on configured per-query timeout.

**Verify**: `rg -n "DNS_SPEED_LAB_MAX_QUERY_ATTEMPTS|DNS_SPEED_LAB_MAX_ESTIMATED_DURATION_SEC" README.md backend/app/runner.py` → each variable appears in both the implementation and README.

### Step 6: Run the full backend gate

Run the normal backend quality gate after all changes. Check that default config still admits an ordinary default request and that all tests continue to isolate filesystem writes under `tmp_path` where appropriate.

**Verify**: `make backend-check` → exit 0.

## Test plan

- Exact budget arithmetic: normal runs + active blocking domains + two diagnostics per resolver, including a direct assertion that the named helper returns the expected one-protocol and multi-protocol totals.
- Attempt budget: one below, exactly at, and one above the configured maximum.
- Estimated-duration budget: rejected independently of attempt count.
- Progress: a terminal benchmark’s count matches the actual number of monkeypatched measurements, including diagnostics.
- Existing behavior: queue count cap, monotonic timestamps, probe response shape, Pydantic validation, and ranking stay intact.
- Final verification: `make backend-check` → all checks pass.

## Done criteria

- [ ] `BenchmarkManager._estimate_benchmark_work()` is the sole deterministic aggregate-work calculation after protocol filtering; ordinary jobs use `protocol_count=1` and later controlled comparisons can reuse its exact signature.
- [ ] Defaults are 10,000 attempts and 14,400 estimated seconds, configurable through the two documented environment variables.
- [ ] A rejected job creates no state, persistence file, or executor task.
- [ ] `progress.total` includes exactly two diagnostics per resolver and terminal `progress.current == progress.total`.
- [ ] Current default and exhaustive catalog workloads remain below both default aggregate limits.
- [ ] `make backend-check` exits 0.
- [ ] `git diff --check` exits 0 and `git status --short` lists only the in-scope files.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- The actual default provider count or active blocking-domain count has changed enough that the documented default/exhaustive workload exceeds either proposed default budget.
- A new aggregate limit would reject a normal UI default request under the documented defaults.
- Another in-flight change already adds work-budget configuration or changes the number of per-resolver diagnostics.
- Implementing the check requires changing `BenchmarkRequest`’s public schema, frontend request construction, or route behavior.
- `make backend-check` fails twice after a reasonable in-scope correction.

## Maintenance notes

- Any future per-resolver diagnostic must update the canonical attempt-count helper and its regression test in the same change.
- Reviewers should verify the pre-enqueue check happens after resolver/protocol filtering and before persistence/executor submission.
- The budget controls admission only. Cooperative cancellation, executor lifecycle shutdown, and `/api/probe` resource isolation remain explicitly deferred.
