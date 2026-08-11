# Plan 017: Compare historical runs only when their immutable manifests match

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. A coordinating reviewer maintains
> `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- backend/app/models.py backend/app/runner.py backend/app/main.py backend/tests/test_history_integrity.py backend/tests/test_comparisons.py frontend/src/App.tsx frontend/src/hooks/useRunHistory.ts frontend/src/hooks/useBenchmarkSession.ts frontend/src/hooks/useRunComparison.ts frontend/src/components/RunHistoryPanel.tsx frontend/src/components/RunComparisonPanel.tsx frontend/src/lib/api.ts frontend/src/lib/types.ts frontend/src/lib/i18n-translations.ts frontend/src/lib/i18n.copy.test.ts frontend/tests/e2e/fixtures.ts frontend/tests/e2e/history-comparison.spec.ts docs/ARCHITECTURE.md README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-dns-response-semantics.md`, `plans/003-profile-target-model.md`, `plans/005-run-history-integrity.md`, `plans/007-frontend-workflow-ownership.md`, `plans/008-results-presentation-correctness.md`, `plans/009-accessibility-i18n-contract.md`, `plans/010-browser-regression-coverage.md`, `plans/014-backend-boundary-hardening.md`, `plans/015-frontend-orchestration-refactor.md`, `plans/016-documentation-contract.md`
- **Category**: direction
- **Planned at**: commit `e09fd2d`, 2026-08-10

## Why this matters

The roadmap promises side-by-side historical run comparison, but a numerical
delta is misleading when the two runs used different resolver targets, query
plans, protocols, scoring policy, or catalog version. The prerequisite plans
make run identity, history, asynchronous ownership, and presentation reliable.
This plan makes comparison validity explicit: it produces deterministic deltas
only for runs whose immutable manifests match, and gives a structured,
successful explanation for every valid but non-comparable pair.

## Current state

- `backend/app/runner.py` — creates `BenchmarkConfig`, persists canonical run
  responses, restores them, and lists history summaries.
- `backend/app/main.py` — already exposes manager-backed history/status/export
  routes.
- `frontend/src/hooks/useRunHistory.ts` and
  `frontend/src/hooks/useBenchmarkSession.ts` — plan 015's sole owners of
  history refresh and current-run selection.
- `frontend/src/components/RunHistoryPanel.tsx` — currently supports a
  single-run selection.
- `frontend/tests/e2e/fixtures.ts` — plan 010's complete mocked-network
  dispatcher.
- `README.md` — lists historical side-by-side comparison as a roadmap item.

The raw configuration contains measurement inputs but the current serialized
state does not yet retain a complete comparison manifest:

```python
# backend/app/runner.py:140-148 and 253-297
class BenchmarkConfig:
    resolvers: list[str]
    queries: list[str]
    runs: int
    timeout_sec: float
    mode: str
    goal: str
    protocol: str

def _build_config(self, req: BenchmarkRequest) -> BenchmarkConfig:
    ...
    return BenchmarkConfig(...)
```

```python
# backend/app/main.py:107-132
@app.get("/api/benchmarks/history")
def benchmark_history() -> dict:
    return manager.list_history()

@app.get("/api/benchmarks/{benchmark_id}")
def benchmark_status(benchmark_id: str, include_samples: bool = Query(default=False)) -> dict:
    state = manager.get(benchmark_id, include_samples=include_samples)
```

```tsx
// frontend/src/components/RunHistoryPanel.tsx:58-84
<ol className="history-list">
  {runs.map((run) => (
    <li key={run.id}>
      <button ... onClick={() => onSelectRun(run.id)}>
```

Existing conventions to preserve:

- Run files remain local JSON; do not add accounts, telemetry, cloud storage,
  or a database.
- Plan 014 validates generated UUIDv4 hex IDs at the manager disk boundary.
  The comparison route must use that existing read path rather than build file
  paths itself.
- Plan 003's canonical `scoring_profile` and `target_snapshot` are the only
  profile/target fields. Do not restore a second `goal`-like policy.
- Plan 007's abort/current-token convention and plan 015's named hooks own
  asynchronous UI work. Plan 008 owns favorable-metric direction.
- ES remains translation source, with EN/PT parity.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend focused tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_history_integrity.py tests/test_comparisons.py` | Exit 0; manifest and comparison cases pass without network DNS. |
| Backend quality gate | `make backend-check` | Exit 0 in a Python 3.13+ project environment. |
| Frontend unit/type checks | `cd frontend && npm test && npm run typecheck` | Exit 0. |
| Browser comparison test | `cd frontend && npm run test:e2e -- --project=chromium tests/e2e/history-comparison.spec.ts` | Exit 0; fixture-only comparison scenarios pass. |
| Frontend quality/build | `cd frontend && npm run lint && npm run build` | Exit 0. |

## Scope

**In scope** (the only files you should modify):

- `backend/app/models.py`
- `backend/app/runner.py`
- `backend/app/main.py`
- `backend/tests/test_history_integrity.py`
- `backend/tests/test_comparisons.py` (new)
- `frontend/src/App.tsx`
- `frontend/src/hooks/useRunHistory.ts`
- `frontend/src/hooks/useBenchmarkSession.ts`
- `frontend/src/hooks/useRunComparison.ts` (new)
- `frontend/src/components/RunHistoryPanel.tsx`
- `frontend/src/components/RunComparisonPanel.tsx` (new)
- `frontend/src/lib/api.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/lib/i18n-translations.ts`
- `frontend/src/lib/i18n.copy.test.ts`
- `frontend/tests/e2e/fixtures.ts`
- `frontend/tests/e2e/history-comparison.spec.ts` (new)
- `docs/ARCHITECTURE.md`
- `README.md`

**Out of scope**:

- CSV/JSON export of a comparison. Defer it until a later plan owns a stable
  export schema; do not add a conditional or undocumented export here.
- Scheduled monitoring, alerts, automatic re-runs, remote storage, accounts,
  or telemetry.
- Comparing legacy or manifest-incomplete runs by inferring data from today's
  catalog, files, or UI state.
- Target/profile selection, raw DNS transport behavior, provider data, and
  scoring weights.
- Refactoring the hooks or Playwright configuration; consume their landed
  contracts from plans 007, 010, and 015.

## Git workflow

- Branch: `advisor/017-profile-aware-history-comparison`
- Use Conventional Commit style, for example:
  `feat(history): compare compatible benchmark runs`.
- Keep manifest/schema, backend route, and hook/UI/test work as separate
  reviewable commits. Do not push or open a PR without explicit operator
  instruction.

## Steps

### Step 1: Specify one strict manifest and response contract before coding

Document the following exact contract in `docs/ARCHITECTURE.md`:

1. `run_manifest_version` starts at `1`. It also contains independent
   `response_semantics_version = "dns-response-v1"` (the Plan-001 RCODE and
   unusable-sample semantics) and `scoring_semantics_version = "score-v1"`.
   Increment the relevant value whenever response classification or ranking
   calculation changes; a profile label alone does not freeze those semantics.
2. Every new run manifest contains those three versions, canonical
   `scoring_profile`, complete `target_snapshot`, `protocol`, `mode`, effective
   `runs`, `timeout_sec`, `normal_query_schedule_version`,
   `normal_query_plan_sha256`, `normal_query_count`,
   `blocking_query_plan_sha256`, `blocking_query_count`,
   `diagnostic_policy_version`, and `provider_catalog_sha256`.
3. `normal_query_schedule_version = "round-robin-v1"` identifies the current
   schedule algorithm. Build the **effective normal schedule** exactly as
   `[config.queries[i % len(config.queries)] for i in range(config.runs)]`;
   hash that list as
   `sha256(json.dumps(schedule, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))`
   and set `normal_query_count = len(schedule)`, which is `runs`. Hash the
   active ordered blocking-domain list with the same JSON rule and set
   `blocking_query_count` to its list length. Thus the manifest freezes the
   actual cyclic query sequence, not merely the source query list. The
   `diagnostic_policy_version` identifies the current randomized-NXDOMAIN
   algorithm but never stores its random label; a random label is not a
   comparison key. If the diagnostic algorithm changes, increment this
   version.
   Build the catalog digest from the static `provider_index` mapping keyed by
   normalized resolver IP and hash
   `json.dumps(provider_index, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`
   encoded as UTF-8. Provider records are loader JSON, so preserve the order of
   arrays inside a record; any catalog-data or list-order change conservatively
   makes runs non-comparable. Never hash timestamps, object identities, or a
   later reload of the catalog.
4. Two `done` runs are comparable only when **every** field above is exactly
   equal, including the full target snapshot, both semantics versions, and
   catalog digest. A target-set difference is `target_snapshot_mismatch`, not
   a partly comparable union.
5. Register `GET /api/benchmarks/compare?baseline_id=<uuid>&candidate_id=<uuid>`
   before the dynamic `GET /api/benchmarks/{benchmark_id}` route. Declare both
   query parameters as optional `str | None`, then require each to be exactly a
   lowercase 32-character UUIDv4 `.hex` value before calling `manager.get()`.
   Missing, malformed, uppercase/hyphenated, or non-v4 IDs are HTTP 404, even
   if an unrelated legacy non-UUID in-memory benchmark happens to exist; this
   comparison endpoint accepts generated persisted-run IDs only. Only
   `status == "done"` is comparison-ready: `queued`, `running`, and `failed`
   each return 409; failed runs are not a hidden terminal comparison mode. Two
   readable `done` runs always produce HTTP 200 with a typed
   `RunComparisonResponse`.
6. `RunComparisonResponse` has exactly `baseline_id: str`,
   `candidate_id: str`, `baseline_manifest: RunManifest | null`,
   `candidate_manifest: RunManifest | null`, `comparable: bool`,
   `reason_codes: list[ComparisonReasonCode]`, `rows: list[RunComparisonRow]`,
   `missing_baseline_results: list[str]`, and
   `missing_candidate_results: list[str]`. `RunComparisonRow` has
   `resolver: str`, `baseline: RunComparisonMetrics`,
   `candidate: RunComparisonMetrics`, `baseline_rank: int`,
   `candidate_rank: int`, and `deltas: RunComparisonDeltas`.
   Each metrics object has nullable float `median_ms`, `p95_ms`,
   `success_rate`, `failure_rate`, `blocking_efficacy`, and `score_total`, plus
   has no rank field; the matching deltas object has nullable floats for those six
   metrics and non-null signed `rank: int`. Missing-result arrays contain only
   canonical resolver-IP strings in response sort order. If either manifest is
   absent or invalid, its corresponding manifest field is `null`, its exact
   `manifest_missing`/`manifest_invalid` reason code remains present, and the
   UI shows only the selected ID plus a translated manifest-unavailable
   explanation—never fields or deltas. If `comparable` is false, all three
   arrays are empty. If true, rows contain only the exact normalized `resolver`
   IP key present in both result arrays; a missing result row is listed in
   exactly one missing array and has no row or delta.

Use exactly these non-comparability codes:
`manifest_missing`, `manifest_invalid`, `manifest_version_mismatch`,
`response_semantics_mismatch`, `scoring_semantics_mismatch`,
`scoring_profile_mismatch`, `target_snapshot_mismatch`, `protocol_mismatch`,
`query_plan_mismatch`, `mode_mismatch`, `runs_mismatch`, `timeout_mismatch`,
`diagnostic_policy_mismatch`, and `provider_catalog_mismatch`. Reason-code
ordering must be stable in the order listed above.

**Verify**: `rg -n "run_manifest_version|response_semantics_version|scoring_semantics_version|target_snapshot_mismatch|RunComparisonResponse|diagnostic_policy_version" docs/ARCHITECTURE.md` → all six terms appear in the finalized contract.

### Step 2: Persist the versioned manifest through the canonical run response

In `backend/app/models.py`, add typed models for the manifest and comparison
response. In `backend/app/runner.py`, build the manifest once from normalized
`BenchmarkConfig`, the plan-003 target/profile values, the loaded blocking
list, Plan-001 response semantics, the scoring-semantics version, and the
exact canonical provider-index hash defined in step 1. Store it in
`BenchmarkState` before the job is submitted and expose it through
`as_response()` so plan 005's canonical persistence path writes it unchanged.

Build the normal-query digest from the exact effective round-robin schedule,
not from `config.queries` alone. Add a focused manifest test with two normalized
queries and more runs than queries to assert the persisted JSON hash/count
matches the explicit repeated schedule; changing the cyclic schedule changes
the digest, while the separately stored `runs` value remains exact.

Do not reconstruct a manifest from a later changed catalog or hash a random
NXDOMAIN label. Existing historical files without a valid manifest stay
readable; they simply produce `manifest_missing` or `manifest_invalid` in a
comparison response.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_history_integrity.py` → exit 0 with byte-stable manifest round-trip and cyclic-schedule hash/count tests for normalized equivalent requests.

### Step 3: Implement the single exact comparison route and calculation

Add `BenchmarkManager.compare_runs(baseline_id, candidate_id)` and register
its static route before `/api/benchmarks/{benchmark_id}`, as defined in step 1.
Add a route regression that proves a request to `/api/benchmarks/compare`
invokes `compare_runs()` and is never captured as `manager.get("compare")`.
In that API test, assert omitted query parameters, malformed strings,
uppercase/hyphenated UUID forms, and a non-v4 UUID all produce 404 before a
manager lookup; a valid lowercase UUIDv4 pair reaches `compare_runs()`.
Retrieve both requested runs only through `manager.get()` so plan 014 remains
the sole disk-ID validation/containment owner. Return 404 if either run is
absent and 409 unless both have `status == "done"`. For two readable `done`
runs, return `RunComparisonResponse` with HTTP 200 even when `comparable` is
false.

For compatible runs, pair only on each result object's exact normalized
`resolver` IP string, never a provider ID or persisted array position, and
sort response rows by that canonical string. Derive each run's one-based rank
at comparison time by sorting its complete result array with the existing
`_resolver_rank_key` and enumerating from 1. Its final resolver-IP term makes
the order total, so ranks never share a tie value; do not trust stored result
order. Each row contains the resolver, baseline and candidate metric objects,
their explicit `baseline_rank`/`candidate_rank`, and signed
candidate-minus-baseline deltas for `median_ms`, `p95_ms`, `success_rate`,
`failure_rate`, `blocking_efficacy`, `score_total`, and `rank`. A negative
rank delta means the candidate improved. Use `null` when either metric is
unavailable; do not substitute zero. Missing result entries are reported
separately as specified in step 1. Do not emit `added_resolvers` or
`removed_resolvers`: a target mismatch is non-comparable by contract.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_comparisons.py` → exit 0 with exact reason-code/order, HTTP status, paired-row, and missing-result cases.

### Step 4: Add comparison selection to the existing lifecycle-hook boundary

Add `useRunComparison.ts`; it is the only owner of baseline/candidate IDs,
comparison loading/error state, request sequence, AbortController, and
unmount cleanup. It must use the plan-007 latest-request behavior and return
typed data to `App` composition. `useRunHistory` continues to own row loading,
and `useBenchmarkSession` continues to own opening one run and live polling.
In `frontend/src/App.tsx`, compose the hook's typed state/callbacks into the
history controls and `RunComparisonPanel`; do not add a second comparison fetch
or state machine to `App`.

Extend `RunHistoryPanel` with explicit baseline/candidate selection controls
that retain its existing “open this run” action. Create
`RunComparisonPanel.tsx` to show every available exact manifest and ordered
reason codes for a non-comparable response; when a manifest field is null, show
only that selected run ID plus the translated manifest-unavailable explanation
defined in step 1. Render paired deltas only for a comparable response. It must
never render a delta row, empty delta chart, or zero placeholder when
`comparable` is false. Use plan-008 metric direction (lower latency is better;
higher success/blocking is better), translated labels, keyboard-operable
controls, and no heavyweight eager chart. A semantic table is sufficient for
this first release.

**Verify**: `cd frontend && npm run typecheck && npm test` → exit 0; no
untyped comparison payload or direct fetch bypass is introduced.

### Step 5: Test only mocked valid/invalid comparisons and document the limit

Extend the plan-010 fixture dispatcher with the exact comparison route and
write `history-comparison.spec.ts`. It must cover:

- selecting two compatible runs renders deterministic paired deltas;
- selecting a target/profile/query-manifest mismatch renders its ordered
  reason codes and no deltas;
- a deferred response for an old pair cannot overwrite a newer pair;
- a legacy run produces `manifest_missing` with no request error;
- no unmatched network request is allowed.

Update README only after the route/UI gates pass. State that comparisons are
local, require matching immutable manifests, and do not prove a causal
resolver regression. Do not add an export claim.

**Verify**: `cd frontend && npm run test:e2e -- --project=chromium tests/e2e/history-comparison.spec.ts && make backend-check && cd frontend && npm run lint && npm run typecheck && npm test && npm run build` → every command exits 0.

## Test plan

- Manifest: equivalent normalized requests produce the same manifest; catalog,
  response/scoring semantics, policy, target, query, and diagnostic changes
  produce the exact ordered reason code. A provider-index serialization test
  proves the stated JSON/hash rule is byte-stable, and a two-query/many-run
  case proves the effective cyclic schedule's hash and count.
- Route: the static compare route wins over the dynamic benchmark-ID route;
  omitted/malformed/non-v4 IDs are 404 before lookup,
  `queued`/`running`/`failed` runs are 409, and every two `done` runs return a
  fully typed 200 response.
- Delta: paired rows use normalized `resolver` IP keys, are resolver-sorted,
  derive one-based `_resolver_rank_key` ranks independent of stored order, and
  are null-safe. The API regression asserts every named response field/type,
  including nullable legacy manifest fields, row-level ranks, metric objects,
  delta map, and sorted missing-IP arrays; a result row missing on one side is
  never shown as a zero delta.
- Browser: compatible, non-comparable, legacy, and stale-pair flows use only
  `frontend/tests/e2e/fixtures.ts` and assert no unhandled network request.

## Done criteria

- [ ] New runs persist a version-1 immutable manifest with every exact field
  from step 1.
- [ ] The exact comparison endpoint is registered before the dynamic benchmark
  route, returns 200 explanation payloads for all readable `done` pairs, and
  returns 404/409 only for missing/malformed/non-v4 or non-`done` runs.
- [ ] Target-set differences never produce a partial union comparison;
  `target_snapshot_mismatch` has no delta rows.
- [ ] Manifest response/scoring versions, reason codes, provider digest, row
  ordering, cyclic query schedule, typed response shape, and one-based rank
  deltas are deterministic; missing/invalid manifests return typed null fields
  and a translated explanation rather than an API error or fabricated metadata.
- [ ] The hook is the sole comparison-request owner; stale pair responses
  cannot overwrite the current selection.
- [ ] The semantic, translated comparison UI handles comparable, legacy, and
  non-comparable responses without a heavyweight eager chart dependency.
- [ ] Backend, frontend, and exact Chromium comparison commands exit 0.
- [ ] No files outside this plan's scope are modified; `plans/README.md`
  remains coordinator-owned.

## STOP conditions

Stop and report back if:

- Any prerequisite plan did not land its named contract, especially canonical
  profile/target state, UUID-contained reads, hooks, or mocked Chromium suite.
- The maintainer rejects strict equality of the manifest fields or requires
  comparison of mismatched target snapshots; that is a different methodology.
- The provider catalog cannot be serialized/hashes cannot be made stable
  without including non-deterministic data or secrets.
- Existing terminal history payloads cannot accommodate an additive manifest
  field without a published compatibility decision.
- A requested export, scheduler, cloud store, or live DNS verification is
  required to complete this feature.

## Maintenance notes

- Any future field that changes measurement interpretation must either become
  a manifest key or be explicitly documented as non-comparison-relevant.
- The comparison endpoint is intentionally conservative: no manifest equality
  means no numerical comparison. Reviewers should reject “best effort” unions.
- A future export/report plan must include the response manifests and
  compatibility verdict; it must not export detached deltas.
