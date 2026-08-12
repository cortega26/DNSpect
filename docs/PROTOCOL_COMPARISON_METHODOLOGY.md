# Protocol Comparison Methodology

This document freezes the exact methodology for measuring one fixed common
target set across UDP, DNS-over-TLS (DoT), DNS-over-HTTPS (DoH), and
DNS-over-QUIC (DoQ). It is the contract for the parent comparison session:
one target snapshot, one query plan, sequential transport subruns inside one
bounded worker, and matched deltas with explicit endpoint caveats.

## Non-negotiable rules

1. **Request model.** `ProtocolComparisonRequest` has exactly these fields and
   rejects unknown fields (`extra="forbid"`): required
   `protocols: list[BenchmarkProtocol]`, required `target_snapshot:
   TargetSnapshot` (the complete canonical Plan-003 snapshot), required
   `scoring_profile: BenchmarkGoal` (the canonical Plan-003 profile),
   `mode: BenchmarkMode = BenchmarkMode.standard`, `queries: list[str] | None
   = None`, `runs: int | None = None`, and `timeout_sec: float = 2.0`.
   `target_snapshot` is the **only** target source: its `resolver_ips` supplies
   the exact ordered normalized resolver-IP list actually measured. There is no
   second top-level `resolvers` field and no reconciliation of two target
   lists.

2. **Protocols.** `protocols` has length two to four. Duplicate values are a
   Pydantic validation error. A valid unique set is normalized to the fixed
   stored/executed order `udp`, `dot`, `doh`, `doq`, independent of caller
   order. `queries`, `runs`, `timeout_sec`, and the target-IP list reuse the
   landed `BenchmarkRequest` validation/effective-runs rules rather than
   copying current numeric limits: `runs=None` means `MODE_DEFAULT_RUNS[mode]`.
   Malformed IP/domain input, invalid enum, duplicate protocol, conflicting or
   malformed Plan-003 snapshot, and out-of-range option input are
   FastAPI/Pydantic 422 responses before manager admission.
   DoQ comparisons require the optional `aioquic` extra
   (`dns.quic.have_quic`); when unavailable, eligible resolvers are excluded
   with the `doq_unavailable` code (the existing exclusion machinery). The
   `manifest_version` was bumped to 2 for this extension.

3. **Shared preflight.** One manager-owned preflight serves both routes:
   `POST /api/protocol-comparisons/preflight` returns a typed
   `ProtocolComparisonPreflightResponse` without allocating an ID or submitting
   work; `POST /api/protocol-comparisons` invokes the same
   `manager.preflight_protocol_comparison(request)` result before admission.
   `ProtocolComparisonPreflightResponse` has exactly `canonical_protocols`,
   `requested_target_snapshot`, `common_eligible_target_snapshot: TargetSnapshot
   | null`, `exclusions: list[ProtocolExclusion]`, `endpoint_identities:
   list[ProtocolEndpointIdentity]`, `normal_query_plan_sha256`,
   `normal_query_count`, `blocking_query_plan_sha256`, `blocking_query_count`,
   `effective_runs`, `timeout_sec`, `total_attempts`, `estimated_duration_sec`,
   `admissible: bool`, and `admission_reason_codes` with only
   `no_common_targets`, `attempt_budget_exceeded`, `duration_budget_exceeded`
   in that stable order. A `ProtocolEndpointIdentity` is exactly `{resolver,
   udp_resolver_ip, dot_hostname: str | null, doh_url: str | null}` for a
   common eligible resolver. A selected DoT/DoH protocol requires its
   corresponding non-null field; an unrequested encrypted transport has `null`
   rather than an invented endpoint. `admissible` is true only when a common
   target exists and the Plan-002 static work estimate is within configured
   limits; it never reserves queue capacity. A no-common preflight has
   `common_eligible_target_snapshot: null` and `endpoint_identities: []`. The
   browser never reimplements eligibility.

4. **Parent API and wire shape.** The start response is exactly
   `{ "comparison_id": "<uuidv4-hex>" }`. Status is
   `GET /api/protocol-comparisons/{comparison_id}` returning
   `ProtocolComparisonStatusResponse`: `comparison_id`, `status` in
   `queued | running | done | failed`, `complete: bool`, `error: str | null`,
   `run_storage_warning: str | null`, `progress` with `current`, `total`,
   `current_protocol: BenchmarkProtocol | null`, `current_resolver: str |
   null`, `last_sample_at: int | null`, `avg_latency_ms: float | null`, a
   `manifest` with `manifest_version`, `scoring_profile`,
   `requested_target_snapshot`, non-null `common_eligible_target_snapshot`,
   `canonical_protocols`, `normal_query_plan_sha256`, `normal_query_count`,
   `blocking_query_plan_sha256`, `blocking_query_count`,
   `diagnostic_policy_version`, `diagnostic_plan_sha256`, `effective_runs`,
   `timeout_sec`, and `endpoint_identities`; `exclusions: list[ProtocolExclusion]`
   where every item is exactly `{resolver, protocol, code}`; `subruns:
   list[ProtocolSubrunResult]` in canonical-protocol order where every item is
   `{protocol, status: "done" | "failed", complete: bool, error:
   ProtocolSubrunError | null, results}` and a `ProtocolSubrunError` is
   `{code: str, message: str}`; and `delta_pairs: list[ProtocolDeltaPair]`.
   `ProtocolDeltaPair` is exactly `{baseline_protocol, candidate_protocol,
   rows}`. Each `ProtocolDeltaRow` is exactly `{resolver, baseline:
   ProtocolMetrics | null, candidate: ProtocolMetrics | null, deltas:
   ProtocolMetricDeltas}`. `ProtocolMetrics` and `ProtocolMetricDeltas` each
   name nullable float `median_ms`, `p95_ms`, `success_rate`, `failure_rate`,
   `blocking_efficacy`, and `score_total`. For every pair, one row per common
   resolver is retained in common-snapshot order; a missing/failed side is
   `null` and all its deltas are `null`, never omitted or replaced with zero.
   There is no cancel route.

5. **Target snapshots.** The requested target snapshot is the Plan-003 ordered
   submitted snapshot; it is not sorted by IP. The common eligible snapshot is
   a separately persisted subsequence in that same order, used by **every**
   subrun. Exclusions are emitted in requested-target order, then canonical
   protocol order. A resolver excluded from any requested transport cannot
   occur in any subrun. When at least one resolver is common, preserve
   `selection_source` and filter `provider_ids` to only keys in the common
   `resolver_ips`; when none is common, return
   `common_eligible_target_snapshot: null`, never an invalid empty
   `TargetSnapshot`.

6. **Eligibility is exact.** UDP uses the resolver IP; DoT requires a
   non-empty syntactically valid DNS hostname in `dot_hostname`; DoH requires
   plan 006's non-empty absolute HTTPS `doh_url`. Missing values produce
   `dot_hostname_missing` or `doh_url_missing`; malformed values produce
   `dot_hostname_invalid` or `doh_url_invalid`.

7. **Diagnostic derivation.** Parent execution order is the canonical
   requested subset of `udp`, `dot`, `doh`, `doq` — not caller order.
   Execution is sequential within one worker. After the parent UUID is allocated, one nonce
   is derived as the first 16 lowercase hex characters of
   `sha256("dnspect-protocol-v1:" + parent_id)`; every diagnostic subrun uses
   `<nonce>.dnspect.invalid`. Only the diagnostic-plan digest and
   `diagnostic_policy_version = "protocol-v1"` are stored in the
   response/manifest — never an additional random query label.

8. **Admission and partial results.** A parent with no common eligible
   resolver or an over-budget static estimate is a well-formed but inadmissible
   request: preflight returns `admissible: false` with `no_common_targets`,
   `attempt_budget_exceeded`, or `duration_budget_exceeded`, and the start
   route returns manager `ValueError` HTTP 400 before enqueueing. Queue
   capacity is rechecked only at start under the shared lock and can
   independently return its established 400. A subrun has `{protocol, status:
   "done" | "failed", complete, error, results}` where a failure error is
   `{code: "transport_execution_failed", message: <safe text>}`. The worker
   records that subrun, continues with later canonical protocols, and leaves
   the parent `status: done`, `complete: false`; only parent orchestration
   failure produces `status: failed`. A terminal persistence failure is a
   non-fatal `run_storage_warning`, following Plan-005 behavior, not a changed
   measurement outcome.

9. **Delta pairs.** Delta pairs use the first canonical requested protocol as
   baseline (UDP when requested, otherwise DoT), then one
   baseline-versus-each-later-protocol pair in canonical order. Each row is
   keyed by normalized resolver IP and has raw baseline/candidate metrics plus
   candidate-minus-baseline deltas for `median_ms`, `p95_ms`, `success_rate`,
   `failure_rate`, `blocking_efficacy`, and `score_total`. Negative
   latency/failure deltas and positive success/blocking/score deltas are
   favorable. If either member is missing or failed, that delta is `null`; no
   alternate pair or zero value is synthesized. Pydantic/schema errors are
   422; well-formed no-common, over-budget, or capacity rejections remain the
   manager's existing 400; unexpected failures remain 500.

## Measurement caveats

- A comparison measures distinct endpoint identities (UDP to an IP, DoT with a
  hostname, DoH with a URL) plus cache and TLS-handshake behavior. Results are
  measured-path caveats, not proof of a transport property. Reviewers reject
  causal language.
- Exclusions are deterministic catalog eligibility facts; they are never
  reliability failures and never appear in subrun results.
- DNS behavior is covered by mocked backend tests; this plan performs no live
  public DoH query and claims no cross-architecture runtime execution.
