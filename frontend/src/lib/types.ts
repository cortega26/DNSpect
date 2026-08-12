export type BenchmarkMode = 'quick' | 'standard' | 'exhaustive'

export type Goal = 'speed' | 'security' | 'privacy' | 'ad-blocking' | 'family'

export type ScoringProfile = Goal

export type SelectionSource = 'manual' | 'catalog' | 'system'

export interface TargetSnapshot {
  resolver_ips: string[]
  selection_source: SelectionSource
  provider_ids?: Record<string, string> | null
}

export type BenchmarkProtocol = 'udp' | 'dot' | 'doh' | 'doq'

export const GOALS: Goal[] = ['speed', 'security', 'privacy', 'ad-blocking', 'family']

export const PROTOCOLS: BenchmarkProtocol[] = ['udp', 'dot', 'doh', 'doq']

// The protocol-comparison contract covers four transports (plan 029):
// udp, dot, doh, doq. See docs/PROTOCOL_COMPARISON_METHODOLOGY.md.
export const COMPARISON_PROTOCOLS: BenchmarkProtocol[] = ['udp', 'dot', 'doh', 'doq']

export interface ProviderFeatures {
  filtering: string
  malware_protection: string
  family: string
  doh: string
  dot: string
  doq?: string | undefined
  doh_url?: string
  dot_hostname?: string
  doq_hostname?: string
}

export interface Provider {
  id: string
  name: string
  dns: string[]
  tags: string[]
  region: string | null
  country: string | null
  goals: Goal[]
  features: ProviderFeatures
  notes_es: string
}

export interface SystemDnsPayload {
  resolvers: string[]
  method: string
  platform: string
  error_detail?: string | null
  detected_provider_id: string
}

export interface Sample {
  run_index: number
  resolver: string
  query: string
  ok: boolean
  ms: number | null
  error: string | null
  failure_kind: 'timeout' | 'nxdomain' | 'servfail' | 'refused' | 'noanswer' | 'other' | null
}

export interface ResolverStats {
  avg_ms: number | null
  median_ms: number | null
  p95_ms: number | null
  min_ms: number | null
  max_ms: number | null
  ok_count: number
  timeout_count: number
  success_rate: number
  timeout_rate: number
  success_count: number
  failure_count: number
  failure_rate: number
  consistency_ratio: number | null
  p95_minus_median_ms: number | null
  score_latency: number | null
  score_reliability: number
  score_stability: number | null
  score_total: number | null
  normalized_latency?: number | null
  normalized_reliability?: number | null
  normalized_stability?: number | null
  reliability_penalty?: number | null
  max_rel_penalty?: number | null
  blocking_efficacy: number | null
  blocked_count: number
  blocking_test_count: number
  score_blocking: number | null
  normalized_blocking: number | null
  nxdomain_hijack_detected?: boolean | null
  dnssec_validating?: boolean | null
}

export interface ResolverResult {
  resolver: string
  provider_id: string
  provider_name: string
  engine: string
  protocol: BenchmarkProtocol
  stats: ResolverStats
  samples: Sample[]
  sample_count?: number
  is_unreliable?: boolean
}

export interface BenchmarkStatus {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: {
    current: number
    total: number
    current_resolver: string | null
    last_sample_at?: number | string | null
    avg_latency_ms?: number | null
  }
  started_at: string
  finished_at: string | null
  mode: BenchmarkMode
  goal?: string
  scoring_profile?: string
  protocol: BenchmarkProtocol
  timeout_sec: number
  runs: number
  engine: string | null
  error: string | null
  run_storage_warning?: string | null
  results: ResolverResult[] | null
  recommended_resolver?: string | null
  recommendation_warning?: string | null
  target_snapshot?: TargetSnapshot | null
  origin?: 'watch' | null
}

export interface ProbeResult {
  resolver: string
  provider_id: string
  provider_name: string
  engine: string
  stats: ResolverStats
  samples: Sample[]
}

export interface ProbeResponse {
  engine: string
  timeout_sec: number
  runs_per_resolver: number
  queried_at: string
  results: ProbeResult[]
}

export type ComparisonReasonCode =
  | 'manifest_missing'
  | 'manifest_invalid'
  | 'manifest_version_mismatch'
  | 'response_semantics_mismatch'
  | 'scoring_semantics_mismatch'
  | 'scoring_profile_mismatch'
  | 'target_snapshot_mismatch'
  | 'protocol_mismatch'
  | 'query_plan_mismatch'
  | 'mode_mismatch'
  | 'runs_mismatch'
  | 'timeout_mismatch'
  | 'diagnostic_policy_mismatch'
  | 'provider_catalog_mismatch'

export interface RunManifest {
  run_manifest_version: number
  response_semantics_version: string
  scoring_semantics_version: string
  scoring_profile: string
  target_snapshot: TargetSnapshot | null
  protocol: BenchmarkProtocol
  mode: BenchmarkMode
  runs: number
  timeout_sec: number
  normal_query_schedule_version: string
  normal_query_plan_sha256: string
  normal_query_count: number
  blocking_query_plan_sha256: string
  blocking_query_count: number
  diagnostic_policy_version: string
  provider_catalog_sha256: string
}

export interface RunComparisonMetrics {
  median_ms: number | null
  p95_ms: number | null
  success_rate: number | null
  failure_rate: number | null
  blocking_efficacy: number | null
  score_total: number | null
}

export interface RunComparisonDeltas extends RunComparisonMetrics {
  rank: number
}

export interface RunComparisonRow {
  resolver: string
  baseline: RunComparisonMetrics
  candidate: RunComparisonMetrics
  baseline_rank: number
  candidate_rank: number
  deltas: RunComparisonDeltas
}

export interface RunComparisonResponse {
  baseline_id: string
  candidate_id: string
  baseline_manifest: RunManifest | null
  candidate_manifest: RunManifest | null
  comparable: boolean
  reason_codes: ComparisonReasonCode[]
  rows: RunComparisonRow[]
  missing_baseline_results: string[]
  missing_candidate_results: string[]
}

export type ProtocolComparisonAdmissionReason =
  | 'no_common_targets'
  | 'attempt_budget_exceeded'
  | 'duration_budget_exceeded'

export interface ProtocolComparisonStartPayload {
  protocols: BenchmarkProtocol[]
  target_snapshot: TargetSnapshot
  scoring_profile: ScoringProfile
  mode: BenchmarkMode
  queries?: string[]
  runs?: number
  timeout_sec: number
}

export interface ProtocolEndpointIdentity {
  resolver: string
  udp_resolver_ip: string
  dot_hostname: string | null
  doh_url: string | null
}

export interface ProtocolExclusion {
  resolver: string
  protocol: BenchmarkProtocol
  code: string
}

export interface ProtocolComparisonPreflight {
  canonical_protocols: BenchmarkProtocol[]
  requested_target_snapshot: TargetSnapshot
  common_eligible_target_snapshot: TargetSnapshot | null
  exclusions: ProtocolExclusion[]
  endpoint_identities: ProtocolEndpointIdentity[]
  normal_query_plan_sha256: string
  normal_query_count: number
  blocking_query_plan_sha256: string
  blocking_query_count: number
  effective_runs: number
  timeout_sec: number
  total_attempts: number
  estimated_duration_sec: number
  admissible: boolean
  admission_reason_codes: ProtocolComparisonAdmissionReason[]
}

export interface ProtocolComparisonProgress {
  current: number
  total: number
  current_protocol: BenchmarkProtocol | null
  current_resolver: string | null
  last_sample_at: number | null
  avg_latency_ms: number | null
}

export interface ProtocolComparisonManifest {
  manifest_version: number
  scoring_profile: string
  requested_target_snapshot: TargetSnapshot
  common_eligible_target_snapshot: TargetSnapshot
  canonical_protocols: BenchmarkProtocol[]
  normal_query_plan_sha256: string
  normal_query_count: number
  blocking_query_plan_sha256: string
  blocking_query_count: number
  diagnostic_policy_version: string
  diagnostic_plan_sha256: string
  effective_runs: number
  timeout_sec: number
  endpoint_identities: ProtocolEndpointIdentity[]
}

export interface ProtocolSubrunError {
  code: string
  message: string
}

export interface ProtocolSubrunResult {
  protocol: BenchmarkProtocol
  status: 'done' | 'failed'
  complete: boolean
  error: ProtocolSubrunError | null
  results: ResolverResult[]
}

export interface ProtocolMetrics {
  median_ms: number | null
  p95_ms: number | null
  success_rate: number | null
  failure_rate: number | null
  blocking_efficacy: number | null
  score_total: number | null
}

export type ProtocolMetricDeltas = ProtocolMetrics

export interface ProtocolDeltaRow {
  resolver: string
  baseline: ProtocolMetrics | null
  candidate: ProtocolMetrics | null
  deltas: ProtocolMetricDeltas
}

export interface ProtocolDeltaPair {
  baseline_protocol: BenchmarkProtocol
  candidate_protocol: BenchmarkProtocol
  rows: ProtocolDeltaRow[]
}

export interface ProtocolComparisonStatus {
  comparison_id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  complete: boolean
  error: string | null
  run_storage_warning: string | null
  progress: ProtocolComparisonProgress
  manifest: ProtocolComparisonManifest
  exclusions: ProtocolExclusion[]
  subruns: ProtocolSubrunResult[]
  delta_pairs: ProtocolDeltaPair[]
}

export interface WatchConfigPayload {
  target_snapshot: TargetSnapshot
  protocol?: BenchmarkProtocol
  scoring_profile?: ScoringProfile
  mode?: BenchmarkMode
  runs?: number | null
  timeout_sec?: number
  interval_min: number
  thresholds?: Record<string, number>
  queries?: string[] | null
}

export interface WatchAlertEvent {
  type: 'threshold_alert' | 'no_comparable_baseline' | 'watch_run_not_done'
  baseline_id?: string | null
  run_id?: string | null
  resolver?: string
  metric?: string
  baseline_value?: number | null
  candidate_value?: number | null
  delta?: number | null
  threshold?: number | null
  status?: string | null
  reason_codes?: string[]
}

export interface WatchRuntime {
  active_run_id: string | null
  last_run_id: string | null
  last_evaluated_at: string | null
  last_alert_at: string | null
  alert_events: WatchAlertEvent[]
}

export interface WatchEntry {
  watch_id: string
  config: WatchConfigPayload
  runtime: WatchRuntime
}

export interface WatchListResponse {
  watches: WatchEntry[]
}
