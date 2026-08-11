# Plan 018: Measure a fixed common target set across UDP, DoT, and DoH

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A coordinating reviewer maintains
> `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- backend/app/models.py backend/app/runner.py backend/app/main.py backend/app/providers.py backend/tests/test_encrypted_dns.py backend/tests/test_providers.py backend/tests/test_protocol_comparison.py frontend/src/App.tsx frontend/src/hooks/useProtocolComparison.ts frontend/src/components/DashboardControls.tsx frontend/src/components/ProtocolComparisonPanel.tsx frontend/src/lib/api.ts frontend/src/lib/types.ts frontend/src/lib/i18n-translations.ts frontend/src/lib/i18n.copy.test.ts frontend/tests/e2e/fixtures.ts frontend/tests/e2e/protocol-comparison.spec.ts docs/PROTOCOL_COMPARISON_METHODOLOGY.md README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-dns-response-semantics.md`, `plans/002-benchmark-work-budget.md`, `plans/003-profile-target-model.md`, `plans/006-provider-data-invariants.md`, `plans/007-frontend-workflow-ownership.md`, `plans/008-results-presentation-correctness.md`, `plans/009-accessibility-i18n-contract.md`, `plans/010-browser-regression-coverage.md`, `plans/012-flatpak-release-parity.md`, `plans/014-backend-boundary-hardening.md`, `plans/015-frontend-orchestration-refactor.md`, `plans/016-documentation-contract.md`, `plans/017-profile-aware-history-comparison.md`
- **Category**: direction
- **Planned at**: commit `e09fd2d`, 2026-08-10

## Why this matters

DNSpect can run UDP, DNS-over-TLS, and DNS-over-HTTPS independently, but those
runs may use different resolver sets, endpoints, query schedules, and timing.
That is not a controlled transport comparison. This plan creates a first-class
parent session that chooses one common eligible target snapshot, derives one
concrete query/diagnostic plan, measures each requested transport sequentially
inside one bounded worker, and reports only matched measurements with precise
endpoint caveats.

## Current state

- `backend/app/models.py` — defines the three `BenchmarkProtocol` values and a
  single-run `BenchmarkRequest`.
- `backend/app/runner.py` — filters per-protocol eligibility, executes
  UDP/DoT/DoH, owns the bounded executor, and currently generates a random
  NXDOMAIN diagnostic suffix per normal run.
- `backend/app/providers.py` and `data/dns_providers.es.json` — load endpoint
  metadata. Plan 006 makes DoH claims/exact URLs valid but deliberately does
  not require `dot_hostname` for every `dot == "yes"` record.
- `frontend/src/hooks/useBenchmarkSession.ts` — plan 015's current
  single-benchmark lifecycle owner; new remote work needs its own named hook.
- `frontend/tests/e2e/fixtures.ts` — plan 010's all-network-mocked dispatcher.

Current eligibility is too permissive for a *matched* encrypted comparison:

```python
# backend/app/runner.py:580-612
def _resolver_supports_protocol(self, resolver_ip: str, protocol: str) -> bool:
    if protocol == "udp":
        return True
    provider = self.provider_index.get(resolver_ip)
    if not provider:
        return False
    features = provider.get("features") or {}
    if protocol == "dot":
        return bool(features.get("dot_hostname") or features.get("dot") == "yes")
    if protocol == "doh":
        return bool(features.get("doh_url") or features.get("doh") == "yes")
```

```python
# backend/app/runner.py:700-705 (current diagnostic shape)
random_label = "".join(random.choices(string.ascii_lowercase + string.digits, k=12))
nxdomain_query = f"{random_label}.dnspect.invalid"
```

`run_dot_query` needs a server hostname and `run_doh_query` needs a concrete
URL (`backend/app/runner.py:825-887`). A protocol comparison must therefore
require a non-empty DoT hostname and a validated DoH URL, not merely a display
flag. It must also use the same one derived NXDOMAIN query for all subruns of
one comparison session.

Existing conventions to preserve:

- Plan 001's non-NOERROR classification is mandatory in every subrun.
- Plan 002 owns aggregate work arithmetic and capacity limits. Do not call
  `BenchmarkManager.start()` recursively from an executor worker.
- Plan 003 provides canonical scoring profile and target snapshot fields;
  plan 017 provides immutable run-manifest conventions.
- Plan 006 is the only catalog-data invariant plan. This plan may exclude a
  record from a comparison due to a missing DoT hostname, but must not invent
  or fetch endpoint metadata.
- UI requests use plan 007 tokens/aborts, plan 015 named hooks, plan 008
  metric direction, and plan 010's Chromium fixture.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend protocol tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_encrypted_dns.py tests/test_providers.py tests/test_protocol_comparison.py` | Exit 0; mocked matrix, state-machine, and RCODE cases pass. |
| Backend quality gate | `make backend-check` | Exit 0 in a Python 3.13+ project environment. |
| Frontend unit/type checks | `cd frontend && npm test && npm run typecheck` | Exit 0. |
| Browser protocol test | `cd frontend && npm run test:e2e -- --project=chromium tests/e2e/protocol-comparison.spec.ts` | Exit 0; fixture-only preflight/progress/partial cases pass. |
| Native Flatpak package import smoke | `flatpak build build-flatpak/build python3 -c 'import httpx; from app.runner import run_doh_query; print("flatpak-doh-import-ok")'` | Prints `flatpak-doh-import-ok` after plan 012's native build. |
| Frontend quality/build | `cd frontend && npm run lint && npm run build` | Exit 0. |

## Scope

**In scope** (the only files you should modify):

- `docs/PROTOCOL_COMPARISON_METHODOLOGY.md` (new)
- `backend/app/models.py`
- `backend/app/runner.py`
- `backend/app/main.py`
- `backend/app/providers.py`
- `backend/tests/test_encrypted_dns.py`
- `backend/tests/test_providers.py`
- `backend/tests/test_protocol_comparison.py` (new)
- `frontend/src/App.tsx`
- `frontend/src/hooks/useProtocolComparison.ts` (new)
- `frontend/src/components/DashboardControls.tsx`
- `frontend/src/components/ProtocolComparisonPanel.tsx` (new; lazy-loaded)
- `frontend/src/lib/api.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/lib/i18n-translations.ts`
- `frontend/src/lib/i18n.copy.test.ts`
- `frontend/tests/e2e/fixtures.ts`
- `frontend/tests/e2e/protocol-comparison.spec.ts` (new)
- `README.md`

**Out of scope**:

- DoQ, TCP, arbitrary user-entered DoH URLs, proxy benchmarking, remote
  vantage points, recurring comparisons, alerts, or provider privacy claims.
- Editing the provider catalog to fill missing DoT/DoH endpoints. Exclude and
  explain absent/ambiguous entries instead.
- A cancellation endpoint or cancelled parent-session status. This application
  has no benchmark cancellation API; do not imply that a UI abort stops work.
- Cross-architecture Flatpak runtime execution. Plan 012 verifies generated
  x86_64/aarch64 inputs and one native package build; an actual aarch64 run
  needs a dedicated runner/approval.
- Refactoring the existing benchmark/history hooks, Playwright configuration,
  or general Flatpak permissions.

## Git workflow

- Branch: `advisor/018-controlled-protocol-comparison`
- Use Conventional Commit style, for example:
  `feat(protocol): add matched DNS transport comparison`.
- Keep methodology/model, backend parent state machine, and UI/browser work in
  separate reviewable commits. Do not push or open a PR without explicit
  operator instruction.

## Steps

### Step 1: Freeze the exact methodology, endpoint rules, and parent API

Create `docs/PROTOCOL_COMPARISON_METHODOLOGY.md` and define these non-negotiable
rules:

1. `ProtocolComparisonRequest` has exactly these fields and
   `extra="forbid"`: required `protocols: list[BenchmarkProtocol]`, required
   `target_snapshot: TargetSnapshot` (the complete canonical Plan-003
   snapshot), required `scoring_profile: BenchmarkGoal` (the canonical
   Plan-003 profile), `mode: BenchmarkMode = BenchmarkMode.standard`,
   `queries: list[str] | None = None`, `runs: int | None = None`, and
   `timeout_sec: float = 2.0`. `target_snapshot` is the **only** target source:
   its `resolver_ips` supplies the exact ordered normalized resolver-IP list
   actually measured. Do not accept a second top-level `resolvers` field or
   reconcile two target lists in this API.
2. `protocols` has length two or three. Reject duplicate values with a Pydantic
   validation error; normalize a valid unique set to the fixed stored/executed
   order `udp`, `dot`, `doh`, independent of caller order. `queries`, `runs`,
   `timeout_sec`, and the target-IP list must reuse the landed
   `BenchmarkRequest` validation/effective-runs rules rather than copy current
   numeric limits: `runs=None` means `MODE_DEFAULT_RUNS[mode]`. Thus malformed
   IP/domain input, invalid enum, duplicate protocol, conflicting or malformed
   Plan-003 snapshot, and out-of-range option input are FastAPI/Pydantic 422
   responses before manager admission.
3. Provide one manager-owned preflight and use it for both routes:
   `POST /api/protocol-comparisons/preflight` returns a typed
   `ProtocolComparisonPreflightResponse` without allocating an ID or submitting
   work; `POST /api/protocol-comparisons` invokes the same
   `manager.preflight_protocol_comparison(request)` result before admission.
   `ProtocolComparisonPreflightResponse` has exactly
   `canonical_protocols: list[BenchmarkProtocol]`,
   `requested_target_snapshot: TargetSnapshot`,
   `common_eligible_target_snapshot: TargetSnapshot | null`,
   `exclusions: list[ProtocolExclusion]`,
   `endpoint_identities: list[ProtocolEndpointIdentity]`,
   `normal_query_plan_sha256: str`, `normal_query_count: int`,
   `blocking_query_plan_sha256: str`, `blocking_query_count: int`,
   `effective_runs: int`, `timeout_sec: float`, `total_attempts: int`,
   `estimated_duration_sec: float`, `admissible: bool`, and
   `admission_reason_codes: list[Literal["no_common_targets",
   "attempt_budget_exceeded", "duration_budget_exceeded"]]` in that stable
   order. A `ProtocolEndpointIdentity` is exactly `{resolver: str,
   udp_resolver_ip: str, dot_hostname: str | null, doh_url: str | null}` for a
   common eligible resolver. A selected DoT/DoH protocol requires its
   corresponding non-null field; an unrequested encrypted transport has `null`
   rather than an invented endpoint. `admissible` is true only when a common
   target exists and the Plan-002 static work estimate is within configured
   limits; it never reserves queue capacity. A no-common preflight has
   `common_eligible_target_snapshot: null` and `endpoint_identities: []`. The
   browser must never reimplement eligibility.
4. The start response is exactly `{ "comparison_id": "<uuidv4-hex>" }`; status
   is `GET /api/protocol-comparisons/{comparison_id}`. Its exact typed wire
   shape is `ProtocolComparisonStatusResponse`:

   - `comparison_id: str`, `status: Literal["queued", "running", "done",
     "failed"]`, `complete: bool`, `error: str | null`, and
     `run_storage_warning: str | null`;
   - `progress: ProtocolComparisonProgress` with `current: int`, `total: int`,
     `current_protocol: BenchmarkProtocol | null`,
     `current_resolver: str | null`, `last_sample_at: int | null`, and
     `avg_latency_ms: float | null`;
   - `manifest: ProtocolComparisonManifest` with `manifest_version: int`,
     `scoring_profile`, `requested_target_snapshot`,
     non-null `common_eligible_target_snapshot`, `canonical_protocols`,
     `normal_query_plan_sha256`, `normal_query_count`,
     `blocking_query_plan_sha256`, `blocking_query_count`,
     `diagnostic_policy_version`, `diagnostic_plan_sha256`, `effective_runs`,
     `timeout_sec`, and `endpoint_identities`;
   - `exclusions: list[ProtocolExclusion]`, where every item is exactly
     `{resolver: str, protocol: BenchmarkProtocol, code: str}`;
     `subruns: list[ProtocolSubrunResult]` in canonical-protocol order, where
     every item is `{protocol, status: "done" | "failed", complete: bool,
     error: ProtocolSubrunError | null, results: list[ResolverResult]}` and a
     `ProtocolSubrunError` is `{code: str, message: str}`; and
     `delta_pairs: list[ProtocolDeltaPair]`.

   `ProtocolDeltaPair` is exactly `{baseline_protocol, candidate_protocol,
   rows}`. Each `ProtocolDeltaRow` is exactly `{resolver: str,
   baseline: ProtocolMetrics | null, candidate: ProtocolMetrics | null,
   deltas: ProtocolMetricDeltas}`. `ProtocolMetrics` and
   `ProtocolMetricDeltas` each name nullable float `median_ms`, `p95_ms`,
   `success_rate`, `failure_rate`, `blocking_efficacy`, and `score_total`.
   For every pair, retain one row per common resolver in common-snapshot order;
   a missing/failed side is `null` and all its deltas are `null`, never omitted
   or replaced with zero. There is no cancel route.
5. The requested target snapshot remains the Plan-003 ordered submitted
   snapshot; do not sort it by IP. The common eligible snapshot is a separately
   persisted subsequence in that same order, used by **every** subrun.
   Exclusions are emitted in requested-target order, then canonical protocol
   order. A resolver excluded from any requested transport cannot occur in any
   subrun. When at least one resolver is common, preserve
   `selection_source` and filter `provider_ids` to only keys in the common
   `resolver_ips`; when none is common, return
   `common_eligible_target_snapshot: null`, never an invalid empty
   `TargetSnapshot`.
6. Eligibility is exact: UDP uses the resolver IP; DoT requires a non-empty
   syntactically valid DNS hostname in `dot_hostname`; DoH requires plan 006's
   non-empty absolute HTTPS `doh_url`. Missing values produce
   `dot_hostname_missing` or `doh_url_missing`; malformed values produce
   `dot_hostname_invalid` or `doh_url_invalid`.
7. Parent execution order is the canonical requested subset of `udp`, `dot`,
   `doh`—not caller order. It is sequential within one worker. After the parent
   UUID is allocated, derive one nonce as the first 16 lowercase hex characters
   of `sha256("dnspect-protocol-v1:" + parent_id)`; use
   `<nonce>.dnspect.invalid` for every diagnostic subrun. Store only the
   diagnostic-plan digest and `diagnostic_policy_version = "protocol-v1"` in
   the response/manifest, not an additional random query label.
8. A parent with no common eligible resolver or an over-budget static estimate
   is a well-formed but inadmissible request: preflight returns
   `admissible: false` with `no_common_targets`, `attempt_budget_exceeded`, or
   `duration_budget_exceeded`, and the start route returns manager `ValueError`
   HTTP 400 before enqueueing. Queue capacity is rechecked only at start under
   the shared lock and can independently return its established 400. A subrun has
   `{protocol, status: "done" | "failed", complete, error, results}` where a
   failure error is `{code: "transport_execution_failed", message: <safe text>}`.
   The worker records that subrun, continues with later canonical protocols,
   and leaves the parent `status: done`, `complete: false`; only parent
   orchestration failure produces `status: failed`. A terminal persistence
   failure is a non-fatal `run_storage_warning`, following Plan-005 behavior,
   not a changed measurement outcome.
9. Delta pairs use the first canonical requested protocol as baseline (UDP when
   requested, otherwise DoT), then one baseline-versus-each-later-protocol pair
   in canonical order. Each row is keyed by normalized resolver IP and has raw
   baseline/candidate metrics plus candidate-minus-baseline deltas for
   `median_ms`, `p95_ms`, `success_rate`, `failure_rate`,
   `blocking_efficacy`, and `score_total`. Negative latency/failure deltas and
   positive success/blocking/score deltas are favorable. If either member is
   missing or failed, that delta is `null`; no alternate pair or zero value is
   synthesized. Pydantic/schema errors are 422; well-formed no-common,
   over-budget, or capacity rejections remain the manager's existing 400;
   unexpected failures remain 500.

**Verify**: `rg -n "POST /api/protocol-comparisons/preflight|common eligible|dot_hostname_missing|protocol-v1|transport_execution_failed|candidate-minus-baseline" docs/PROTOCOL_COMPARISON_METHODOLOGY.md` → all contract terms appear.

### Step 2: Implement typed preflight and strict comparison-only endpoint validation

Add the Pydantic request, preflight, parent-status, subrun-error, and delta-pair
models in `backend/app/models.py`; the request must compose the landed Plan-003
`TargetSnapshot` rather than a parallel dict. Add one comparison-only endpoint
validation/preflight helper in `backend/app/providers.py` or
`backend/app/runner.py`. It must use plan 006's loader-validated DoH URL and
add only comparison-time DNS-hostname syntax validation for `dot_hostname`.
Do not make all existing single-protocol DoT benchmarks fail because a catalog
entry lacks a hostname; preflight exclusion is intentionally narrower.

`manager.preflight_protocol_comparison(request)` is the single source for the
preflight route and start admission. It accepts the already Pydantic-normalized
request and returns the exact typed preflight model defined in step 1. Walk the
Plan-003 snapshot's ordered normalized target IPs without re-sorting them;
build `requested_target_snapshot`, the in-order
`common_eligible_target_snapshot`, and one exclusion object per resolver and
protocol in that target order then canonical protocol order. Build endpoint
identities as `{udp_resolver_ip, dot_hostname, doh_url}` for each common
resolver, with DoT/DoH values non-null only when that protocol was requested.
Add exact provider tests for valid hostname, empty hostname, invalid hostname,
valid DoH URL, missing URL, and an unrequested transport's null endpoint field
without any network request.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_providers.py tests/test_protocol_comparison.py` → exit 0 with 422 duplicate/invalid-input, in-order eligible/exclusion, and deterministic shared-preflight assertions.

### Step 3: Add one non-recursive, pre-admitted parent state machine

In `BenchmarkManager`, add a separate `_protocol_comparison_states` map
protected by the existing `RLock`. Extend capacity accounting so queued/running
comparison parents and ordinary benchmark jobs share
`max_concurrent_jobs + max_queued_jobs`. Add
`_cleanup_protocol_comparison_states_locked()` with the same
`terminal_ttl_sec` and `max_retained_states` policy as ordinary in-memory
states: it removes only finished `done`/`failed` comparison entries by terminal
time/oldest-first cap, never queued/running entries, and never deletes their
persisted terminal JSON. Invoke it under the lock before comparison admission
and before retaining a reloaded terminal response, so this new map cannot grow
without bound. After successful shared preflight, allocate a UUIDv4 hex parent
ID. Only after checking `preflight.admissible is True` and binding its non-null
`common_eligible_target_snapshot` may the manager call exactly this Plan-002
contract before state insertion or executor submission:

```python
self._estimate_benchmark_work(
    resolver_count=len(preflight.common_eligible_target_snapshot.resolver_ips),
    runs=effective_runs,
    timeout_sec=timeout_sec,
    protocol_count=len(preflight.canonical_protocols),
)
```

Reject the parent from the returned `total_attempts` and
`estimated_duration_sec` under the same configured limits as ordinary jobs.
Do not reproduce the formula or introduce a second comparison-specific budget.
Insert the state only after the shared capacity check, then submit exactly one
`_run_protocol_comparison(parent_id, plan)` task to the existing executor. If
that submission raises `RuntimeError`, remove the newly inserted in-memory
state under the lock, create no persisted file, return the existing Spanish
`ValueError` admission failure, and never return an ID. The worker must never
call `start()`, never submit a child future, and must run the canonical protocol
order sequentially.

Persist comparison parents separately at
`data/runs/protocol-comparisons/<comparison_id>.json`, never alongside the
ordinary top-level run files. Define `ProtocolComparisonState.as_response()` as
the one canonical JSON-safe serializer. It must call
`_sanitize_results(subrun.results, include_samples=False)` (or an exact
equivalent) for **every** nested subrun before both status response and disk
serialization: retain `sample_count`, but every serialized `samples` list is
empty and no raw timing sample is written. There is no comparison
`include_samples` route switch. Write only terminal `done`/`failed` states
through `_persist_protocol_comparison()`, under the same narrow RLock visibility
barrier as plan 005. An `OSError` during that terminal write sets
`run_storage_warning` and leaves the measured terminal response available in
memory; it does not turn `done` into `failed` or retry indefinitely.
Queued/running parents remain in memory only: after a process restart they are
absent rather than falsely resumable. A terminal parent reloads through
`get_protocol_comparison()` from that exact path; no comparison state is added
to `list_history()`.

Do not assume plan 014 protects this new path. Implement
`_persisted_protocol_comparison_path(comparison_id) -> Path | None` with the
same lowercase UUIDv4-hex validation and resolved-directory containment rules,
then make `get_protocol_comparison()` perform in-memory lookup first and use
that helper only on a miss. Invalid IDs must not build/read a disk path. A new
manager over the same temporary data directory must reload a terminal parent;
it must never resume a worker. Test that the nested directory leaves ordinary
history listings unchanged.

Refactor only enough measurement internals to accept a concrete query plan,
fixed diagnostic domain, parent progress callback, and explicit endpoint
identity. Each subrun uses the same common eligible resolver list and query
schedule. Persist the parent state's complete manifest and per-subrun results
through that one canonical serializer; do not create independently schedulable
child benchmark records. Increment parent progress once for every normal,
blocking, NXDOMAIN, and DNSSEC attempt. Apply plan 001 classification before
any sample affects a subrun result. Require
`progress.current == progress.total` only when `status == "done"` and
`complete is true` (all planned subruns finished). Partial `done` and failed
parents may finish with `current < total`; never fabricate progress to 100%.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_protocol_comparison.py tests/test_encrypted_dns.py` → mocked tests prove one executor submission/rollback, no recursive `start`, Plan-002 helper use, terminal-map cleanup, exact pre-admission arithmetic, terminal reload/invalid-ID containment, history exclusion, no raw samples on disk/status, Plan-005-compatible write warning, identical common targets/query digest across subruns, and complete-only terminal progress equality.

### Step 4: Expose the exact routes and partial-result semantics

Add only these routes in `backend/app/main.py`:

- `POST /api/protocol-comparisons/preflight` → 200 typed preflight for a
  schema-valid request, including `admissible: false` and exclusions when no
  common target exists; no state, file, or executor task is created.
- `POST /api/protocol-comparisons` → 200 `{comparison_id}` after manager
  admission. FastAPI/Pydantic body errors are 422; schema-valid no-common,
  over-budget, and shared-capacity rejections are the manager's established
  400; unexpected failures are 500.
- `GET /api/protocol-comparisons/{comparison_id}` → 200 typed parent status,
  404 when the ID is absent/invalid through the new contained comparison lookup,
  and no `include_samples` switch in this first feature.

Register the static preflight route before the dynamic status route and test
that it cannot be interpreted as comparison ID `"preflight"`.

For a complete parent, calculate only the exact baseline-versus-later-protocol
pairs defined in step 1 and only for resolver/protocol cells with both required
metrics. For a partial parent, retain successful subrun raw results but set all
deltas that depend on a missing or failed side to `null`, accompanied by the
typed subrun error. Continue later protocols after a transport-specific subrun
failure; do not invent an alternate baseline/pair. Do not introduce a
`cancelled` status or a `cancel` endpoint.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_protocol_comparison.py` → exit 0 with preflight/start/status/404/422/400/partial/failed response-shape and three-protocol pair-order cases.

### Step 5: Add a separate frontend comparison owner and lazy presentation

Create `useProtocolComparison.ts` as the sole owner of comparison start/status
polling, latest request token, AbortController, and unmount cleanup. Its UI
abort stops interest in a response only; it must never say a server comparison
was cancelled. Keep `useBenchmarkSession` as the owner of ordinary benchmarks
and make `App.tsx` only compose the two workflows.

Add an explicit comparison mode/control in `DashboardControls.tsx` that
selects two or three protocols without changing the existing single-protocol
control's meaning. On every relevant target/profile/protocol input change, call
only the typed preflight endpoint through `useProtocolComparison.ts`; display
its requested count, common eligible count (`0` when the nullable common
snapshot is absent), stable exclusions, and disabled start state when
`admissible` is false. The hook aborts/supersedes stale preflight requests with
the same latest-request ownership rules as its start / status work. At start,
submit the identical normalized payload and show that every subrun uses the
admitted preflight's non-null common eligible snapshot. Do not duplicate
backend endpoint eligibility in the browser.

Lazy-load `ProtocolComparisonPanel.tsx`; show protocol endpoint identities,
raw per-protocol metrics, complete/partial status, exclusion reasons, and
delta pairs in their retained common-target order. For a row with a null side
or null deltas, show the resolver plus a translated unavailable/error marker;
do not omit that row or render zero as a delta. Use plan 008's metric
directions; keep all new UI copy in the ES/EN/PT translation contract and make
controls keyboard operable.

**Verify**: `cd frontend && npm run typecheck && npm test` → exit 0; types
model exact parent/status data and no eager Recharts import is added.

### Step 6: Test the fixture-only UI and native packaged import boundary

Extend `frontend/tests/e2e/fixtures.ts` for all three exact
protocol-comparison routes and add `protocol-comparison.spec.ts`. Cover a
preflight with an excluded resolver, a non-admissible preflight that disables
start, one start POST after a preflight, queued/running/done progress, a
three-protocol baseline-pair response, a partial subrun result whose dependent
deltas are null but whose resolver row remains visible with an unavailable
marker, and a late old-parent/preflight response that cannot replace a newer
one. Assert every test has no unhandled network request.

After plan 012 has built the native Flatpak app, run the exact package import
smoke from the command table. It proves the packaged runtime contains `httpx`
and the DoH runner import path. DNS behavior remains covered by mocked backend
tests; do not make this plan perform a live public DoH query or claim aarch64
runtime execution.

Update README only after all gates pass, describing the local-methodology
caveat and common-target exclusion behavior rather than a general claim about
provider privacy or universal performance.

**Verify**: `cd frontend && npm run test:e2e -- --project=chromium tests/e2e/protocol-comparison.spec.ts && make backend-check && cd frontend && npm run lint && npm run typecheck && npm test && npm run build && cd .. && flatpak build build-flatpak/build python3 -c 'import httpx; from app.runner import run_doh_query; print("flatpak-doh-import-ok")'` → every command exits 0 and the package command prints `flatpak-doh-import-ok`.

## Test plan

- Request/preflight: the sole `target_snapshot` source, canonical protocol
  normalization, required profile/default mode/runs/timeout semantics,
  duplicate/malformed 422 cases, requested/common in-order snapshots, every
  named preflight/status/delta wire field/type, deterministic exclusion reasons,
  DoT hostname validation, DoH URL validation, static-budget reason codes, and
  no-common `common_eligible_target_snapshot: null` / `admissible: false` /
  start 400 behavior. A two-protocol case proves unrequested endpoint metadata
  is `null`, while requested encrypted endpoints remain required.
- Parent state machine: one executor task, no recursive `start`, shared queue
  capacity, the exact Plan-002 `_estimate_benchmark_work()` call,
  aggregate attempts/duration, submission rollback with no ID/file, bounded
  terminal-state cleanup, fixed protocol order, same query digest/diagnostic
  domain, and complete-only exact progress.
- Measurement: mocked UDP/DoT/DoH success and non-NOERROR samples retain plan
  001 classification; transport-specific failure continues later protocols;
  partial and failed parent states never invent deltas.
- Persistence/API: all three exact route schemas, static-preflight route order,
  422 versus manager-400 versus 500 behavior, invalid/missing comparison ID,
  terminal reload after a new manager, no reload/resumption of in-flight work,
  exclusion from ordinary history, exact two/three-protocol pair ordering with
  retained null rows, no raw samples in status/on-disk JSON, non-fatal terminal
  storage warning, and no cancellation route/status.
- Browser: fixture-only preflight, disabled non-admissible start,
  start/progress, partial outcome, stale preflight/parent response, translated
  labels, and no unhandled network.
- Package: native Flatpak import of `httpx` and `run_doh_query`, not a claim of
  live DoH or non-native architecture execution.

## Done criteria

- [ ] One parent session records distinct requested and common eligible target
  snapshots in Plan-003 target order; every admitted subrun uses the latter
  exactly. A no-common preflight uses a typed null common snapshot with no
  endpoint identities, never an invalid empty TargetSnapshot.
- [ ] `ProtocolComparisonRequest` has one target source, rejects duplicate
  protocols/schema errors as 422, and the manager-owned preflight is the sole
  eligibility calculation for both UI and admission; all request, preflight,
  status, subrun, error, and delta-pair fields have the exact declared wire
  shape.
- [ ] DoT comparison eligibility requires a valid hostname and DoH requires a
  plan-006 URL; exclusions are deterministic and never count as reliability
  failures.
- [ ] Parent admission calls the named Plan-002 work-estimate helper with the
  common-target and protocol counts, accounts for all requested attempts, and
  shares ordinary benchmark queue limits before one worker is submitted; a
  failed executor submission rolls back the map without an ID or JSON file.
- [ ] The parent worker performs no recursive enqueue, uses canonical protocol
  order, one derived diagnostic domain, bounded terminal-state cleanup, and
  truthful progress (`current == total` only for complete done parents).
- [ ] The exact preflight/POST/GET routes return typed data with clear
  422/400/500 boundaries; partial subruns continue later protocols, use
  `complete: false` and null unsupported baseline-pair deltas, not a cancelled
  status.
- [ ] Terminal comparison records use the contained nested persistence path,
  reload after manager restart, reject invalid IDs before disk access, and do
  not appear in ordinary run history; in-flight work is never resumed. Their
  status/disk payloads retain counts but no raw samples, and write errors remain
  a non-fatal storage warning.
- [ ] The comparison UI is translated, keyboard-operable, lazy-loaded, and
  latest-response safe.
- [ ] Backend, exact Chromium test, frontend gates, and native Flatpak import
  smoke exit 0.
- [ ] No files outside this plan's scope are modified; `plans/README.md`
  remains coordinator-owned.

## STOP conditions

Stop and report back if:

- A required prerequisite contract is absent, especially plan 002's named
  `_estimate_benchmark_work()` helper, plan 006's URL validator, plan 003's
  canonical target-snapshot model, plan 009's localization/accessibility
  contract, plan 016's documentation contract, or plan 010's fixture command.
- The project must treat an empty `dot_hostname` as a comparable encrypted
  endpoint, or a desired endpoint identity cannot be represented without
  inventing catalog data.
- The parent cannot be implemented as one bounded executor task without
  recursive submission, shared-capacity accounting, or a change to the queue
  model beyond this scope.
- A requirement asks for cancellation semantics, a live external DoH smoke,
  provider privacy claims, or an aarch64 Flatpak run without an approved runner.
- The requested/common target contract or fixed diagnostic derivation is not
  acceptable to the methodology owner.
- The separate comparison path cannot enforce UUIDv4-hex validation and
  resolved-directory containment without broadening the ordinary-run disk
  boundary or silently making an in-flight comparison resumable.

## Maintenance notes

- A new transport must extend strict comparison eligibility, requested/common
  snapshot recording, aggregate budget, parent state machine, fixtures,
  translations, and package import coverage together.
- The nested terminal store is intentionally separate from benchmark history.
  This plan bounds the in-memory terminal map only; it does not delete
  persisted terminal comparison JSON. Any future disk-retention or
  comparison-history/list feature needs its own ordering, reload, and privacy
  review; do not merge files into the ordinary run glob.
- Reviewers should reject causal language: different endpoint identities and
  cache/handshake behavior are measured-path caveats, not proof of a transport
  property.
- DoQ, remote vantage points, monitoring, alerts, and cross-architecture
  runtime certification remain deliberately separate initiatives.
