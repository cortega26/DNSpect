import type { RunHistoryEntry } from '../../src/lib/api'
import type {
  BenchmarkStatus,
  BenchmarkProtocol,
  ProbeResponse,
  ProtocolComparisonPreflight,
  ProtocolComparisonStatus,
  ProtocolDeltaPair,
  ProtocolSubrunResult,
  ResolverResult,
  ResolverStats,
  RunComparisonResponse,
  RunManifest,
  SystemDnsPayload,
  WatchEntry,
} from '../../src/lib/types'

export const systemDnsFixture: SystemDnsPayload = {
  resolvers: ['192.168.1.1'],
  method: 'systemd-resolve',
  platform: 'Linux (Test)',
  error_detail: null,
  detected_provider_id: 'isp-detectado',
}

export const geoIpFixture = {
  country_code: 'CO',
  country_name: 'Colombia',
  region: null,
  city: null,
  source: 'GeoIP database',
}

export const publicIpFixture = { ip: '200.100.50.1' }

export function makeStats(avgMs: number): ResolverStats {
  return {
    avg_ms: avgMs,
    median_ms: avgMs,
    p95_ms: avgMs * 1.4,
    min_ms: avgMs * 0.7,
    max_ms: avgMs * 1.8,
    ok_count: 30,
    timeout_count: 0,
    success_rate: 1,
    timeout_rate: 0,
    success_count: 30,
    failure_count: 0,
    failure_rate: 0,
    consistency_ratio: 0.9,
    p95_minus_median_ms: avgMs * 0.4,
    score_latency: avgMs,
    score_reliability: 1,
    score_stability: 0.9,
    score_total: 0.97,
    normalized_latency: 0.9,
    normalized_reliability: 1,
    normalized_stability: 0.9,
    reliability_penalty: 0,
    max_rel_penalty: 0,
    blocking_efficacy: null,
    blocked_count: 0,
    blocking_test_count: 0,
    score_blocking: null,
    normalized_blocking: null,
    nxdomain_hijack_detected: null,
    dnssec_validating: null,
  }
}

export function makeResult(resolver: string, providerId: string, providerName: string, avgMs: number): ResolverResult {
  return {
    resolver,
    provider_id: providerId,
    provider_name: providerName,
    engine: 'drill',
    protocol: 'udp',
    stats: makeStats(avgMs),
    samples: [],
    sample_count: 30,
    is_unreliable: false,
  }
}

export const CLOUDFLARE_RESULT = makeResult('1.1.1.1', 'cloudflare', 'Cloudflare', 12.3)
const GOOGLE_RESULT = makeResult('8.8.8.8', 'google', 'Google Public DNS', 18.9)
export const QUAD9_RESULT = makeResult('9.9.9.9', 'quad9', 'Quad9', 26.4)

export function doneBenchmark(id: string, topResult: ResolverResult): BenchmarkStatus {
  const now = new Date()
  const startedAt = new Date(now.getTime() - 120_000).toISOString()
  const finishedAt = new Date(now.getTime() - 5_000).toISOString()
  const results = [topResult, GOOGLE_RESULT]
  return {
    id,
    status: 'done',
    progress: { current: 30, total: 30, current_resolver: null, last_sample_at: now.getTime(), avg_latency_ms: 15.5 },
    started_at: startedAt,
    finished_at: finishedAt,
    mode: 'standard',
    goal: 'speed',
    scoring_profile: 'speed',
    protocol: 'udp',
    timeout_sec: 2,
    runs: 30,
    engine: 'drill',
    error: null,
    run_storage_warning: null,
    results,
    recommended_resolver: topResult.resolver,
    recommendation_warning: null,
    target_snapshot: {
      resolver_ips: results.map((row) => row.resolver),
      selection_source: 'manual',
      provider_ids: { [topResult.resolver]: topResult.provider_id },
    },
  }
}

export function runningBenchmark(id: string): BenchmarkStatus {
  return {
    id,
    status: 'running',
    progress: { current: 12, total: 30, current_resolver: '1.1.1.1', last_sample_at: Date.now(), avg_latency_ms: 14.2 },
    started_at: new Date(Date.now() - 10_000).toISOString(),
    finished_at: null,
    mode: 'standard',
    goal: 'speed',
    scoring_profile: 'speed',
    protocol: 'udp',
    timeout_sec: 2,
    runs: 30,
    engine: 'drill',
    error: null,
    run_storage_warning: null,
    results: [CLOUDFLARE_RESULT],
    recommended_resolver: null,
    recommendation_warning: null,
    target_snapshot: { resolver_ips: ['1.1.1.1', '8.8.8.8'], selection_source: 'manual', provider_ids: null },
  }
}

export function queuedBenchmark(id: string): BenchmarkStatus {
  return {
    id,
    status: 'queued',
    progress: { current: 0, total: 30, current_resolver: null, last_sample_at: Date.now(), avg_latency_ms: null },
    started_at: new Date(Date.now() - 1_000).toISOString(),
    finished_at: null,
    mode: 'standard',
    goal: 'speed',
    scoring_profile: 'speed',
    protocol: 'udp',
    timeout_sec: 2,
    runs: 30,
    engine: null,
    error: null,
    run_storage_warning: null,
    results: [],
    recommended_resolver: null,
    recommendation_warning: null,
    target_snapshot: { resolver_ips: ['1.1.1.1', '8.8.8.8'], selection_source: 'manual', provider_ids: null },
  }
}

export function historyEntry(id: string, topResolver: string, topProvider: string, startedAt: string): RunHistoryEntry {
  return {
    id,
    mode: 'standard',
    goal: 'speed',
    scoring_profile: 'speed',
    protocol: 'udp',
    started_at: startedAt,
    finished_at: null,
    status: 'done',
    results_summary: [{ provider_name: topProvider, resolver: topResolver }],
    target_snapshot: null,
  }
}

export function makeWatchEntry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    watch_id: 'watch-001',
    config: {
      target_snapshot: { resolver_ips: ['1.1.1.1'], selection_source: 'manual' },
      protocol: 'udp',
      mode: 'standard',
      interval_min: 30,
    },
    runtime: {
      active_run_id: null,
      last_run_id: CANDIDATE_RUN_ID,
      last_evaluated_at: new Date().toISOString(),
      last_alert_at: new Date().toISOString(),
      alert_events: [
        {
          type: 'threshold_alert',
          baseline_id: BASELINE_RUN_ID,
          run_id: CANDIDATE_RUN_ID,
          resolver: '1.1.1.1',
          metric: 'success_rate',
          baseline_value: 0.99,
          candidate_value: 0.93,
          delta: 0.06,
          threshold: 5.0,
        },
      ],
    },
    ...overrides,
  }
}

export function makeRunManifest(): RunManifest {
  return {
    run_manifest_version: 1,
    response_semantics_version: 'dns-response-v1',
    scoring_semantics_version: 'score-v1',
    scoring_profile: 'speed',
    target_snapshot: {
      resolver_ips: ['1.1.1.1', '9.9.9.9'],
      selection_source: 'manual',
      provider_ids: null,
    },
    protocol: 'udp',
    mode: 'standard',
    runs: 30,
    timeout_sec: 2,
    normal_query_schedule_version: 'round-robin-v1',
    normal_query_plan_sha256: 'a'.repeat(64),
    normal_query_count: 30,
    blocking_query_plan_sha256: 'b'.repeat(64),
    blocking_query_count: 9,
    diagnostic_policy_version: 'random-nxdomain-v1',
    provider_catalog_sha256: 'c'.repeat(64),
  }
}

export const BASELINE_RUN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const CANDIDATE_RUN_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

export function comparableComparisonResponse(): RunComparisonResponse {
  return {
    baseline_id: BASELINE_RUN_ID,
    candidate_id: CANDIDATE_RUN_ID,
    baseline_manifest: makeRunManifest(),
    candidate_manifest: makeRunManifest(),
    comparable: true,
    reason_codes: [],
    rows: [
      {
        resolver: '1.1.1.1',
        baseline: { median_ms: 12.3, p95_ms: 17.22, success_rate: 1, failure_rate: 0, blocking_efficacy: null, score_total: 0.91 },
        candidate: { median_ms: 15.2, p95_ms: 21.28, success_rate: 1, failure_rate: 0, blocking_efficacy: null, score_total: 0.95 },
        baseline_rank: 1,
        candidate_rank: 2,
        deltas: { median_ms: 2.9, p95_ms: 4.06, success_rate: 0, failure_rate: 0, blocking_efficacy: null, score_total: 0.04, rank: 1 },
      },
      {
        resolver: '9.9.9.9',
        baseline: { median_ms: 26.4, p95_ms: 36.96, success_rate: 1, failure_rate: 0, blocking_efficacy: null, score_total: 0.97 },
        candidate: { median_ms: 20.1, p95_ms: 28.14, success_rate: 1, failure_rate: 0, blocking_efficacy: null, score_total: 0.9 },
        baseline_rank: 2,
        candidate_rank: 1,
        deltas: { median_ms: -6.3, p95_ms: -8.82, success_rate: 0, failure_rate: 0, blocking_efficacy: null, score_total: -0.07, rank: -1 },
      },
    ],
    missing_baseline_results: [],
    missing_candidate_results: [],
  }
}

export function nonComparableComparisonResponse(): RunComparisonResponse {
  return {
    baseline_id: BASELINE_RUN_ID,
    candidate_id: CANDIDATE_RUN_ID,
    baseline_manifest: makeRunManifest(),
    candidate_manifest: {
      ...makeRunManifest(),
      scoring_profile: 'security',
      protocol: 'dot',
      target_snapshot: { resolver_ips: ['1.1.1.1'], selection_source: 'manual', provider_ids: null },
    },
    comparable: false,
    reason_codes: ['target_snapshot_mismatch', 'protocol_mismatch', 'scoring_profile_mismatch'],
    rows: [],
    missing_baseline_results: [],
    missing_candidate_results: [],
  }
}

export function manifestMissingComparisonResponse(): RunComparisonResponse {
  return {
    baseline_id: BASELINE_RUN_ID,
    candidate_id: CANDIDATE_RUN_ID,
    baseline_manifest: null,
    candidate_manifest: makeRunManifest(),
    comparable: false,
    reason_codes: ['manifest_missing'],
    rows: [],
    missing_baseline_results: [],
    missing_candidate_results: [],
  }
}

// ---- Protocol comparison fixtures --------------------------------------------

export function protocolComparisonPreflightFixture(
  overrides: Partial<ProtocolComparisonPreflight> = {},
): ProtocolComparisonPreflight {
  const target = {
    resolver_ips: ['1.1.1.1', '9.9.9.9'],
    selection_source: 'manual' as const,
    provider_ids: { '1.1.1.1': 'cloudflare', '9.9.9.9': 'quad9' },
  }
  return {
    canonical_protocols: ['udp', 'dot'],
    requested_target_snapshot: target,
    common_eligible_target_snapshot: target,
    exclusions: [],
    endpoint_identities: [
      { resolver: '1.1.1.1', udp_resolver_ip: '1.1.1.1', dot_hostname: 'one.one.one.one', doh_url: null },
      { resolver: '9.9.9.9', udp_resolver_ip: '9.9.9.9', dot_hostname: 'dns.quad9.net', doh_url: null },
    ],
    normal_query_plan_sha256: 'a'.repeat(64),
    normal_query_count: 30,
    blocking_query_plan_sha256: 'b'.repeat(64),
    blocking_query_count: 9,
    effective_runs: 30,
    timeout_sec: 2,
    total_attempts: 246,
    estimated_duration_sec: 640,
    admissible: true,
    admission_reason_codes: [],
    ...overrides,
  }
}

export function protocolComparisonPreflightWithExclusionFixture(): ProtocolComparisonPreflight {
  const base = protocolComparisonPreflightFixture({
    canonical_protocols: ['udp', 'dot', 'doh'],
    endpoint_identities: [
      { resolver: '1.1.1.1', udp_resolver_ip: '1.1.1.1', dot_hostname: 'one.one.one.one', doh_url: 'https://cloudflare-dns.com/dns-query' },
      { resolver: '9.9.9.9', udp_resolver_ip: '9.9.9.9', dot_hostname: 'dns.quad9.net', doh_url: null },
    ],
  })
  return {
    ...base,
    exclusions: [{ resolver: '8.20.247.20', protocol: 'doh', code: 'doh_url_missing' }],
  }
}

export function protocolComparisonNotAdmissibleFixture(): ProtocolComparisonPreflight {
  return protocolComparisonPreflightFixture({
    common_eligible_target_snapshot: null,
    endpoint_identities: [],
    exclusions: [
      { resolver: '1.1.1.1', protocol: 'dot', code: 'dot_hostname_missing' },
      { resolver: '9.9.9.9', protocol: 'dot', code: 'dot_hostname_missing' },
    ],
    admissible: false,
    admission_reason_codes: ['no_common_targets'],
  })
}

const COMPARISON_TARGET = {
  resolver_ips: ['1.1.1.1', '9.9.9.9'],
  selection_source: 'manual' as const,
  provider_ids: { '1.1.1.1': 'cloudflare', '9.9.9.9': 'quad9' },
}

function protocolComparisonManifest(comparisonId: string, protocols: BenchmarkProtocol[]): ProtocolComparisonStatus['manifest'] {
  return {
    manifest_version: 1,
    scoring_profile: 'speed',
    requested_target_snapshot: COMPARISON_TARGET,
    common_eligible_target_snapshot: COMPARISON_TARGET,
    canonical_protocols: protocols,
    normal_query_plan_sha256: 'a'.repeat(64),
    normal_query_count: 30,
    blocking_query_plan_sha256: 'b'.repeat(64),
    blocking_query_count: 9,
    diagnostic_policy_version: 'protocol-v1',
    diagnostic_plan_sha256: 'c'.repeat(64),
    effective_runs: 30,
    timeout_sec: 2,
    endpoint_identities: [
      { resolver: '1.1.1.1', udp_resolver_ip: '1.1.1.1', dot_hostname: 'one.one.one.one', doh_url: null },
      { resolver: '9.9.9.9', udp_resolver_ip: '9.9.9.9', dot_hostname: 'dns.quad9.net', doh_url: null },
    ],
  }
}

export function protocolSubrunFixture(
  protocol: 'udp' | 'dot' | 'doh',
  status: 'done' | 'failed',
  errorMessage?: string,
): ProtocolSubrunResult {
  const results =
    status === 'done'
      ? [makeResult('1.1.1.1', 'cloudflare', 'Cloudflare', 12.3), makeResult('9.9.9.9', 'quad9', 'Quad9', 26.4)]
      : []
  return {
    protocol,
    status,
    complete: status === 'done',
    error: errorMessage ? { code: 'transport_execution_failed', message: errorMessage } : null,
    results,
  }
}

function protocolDeltaPairFixture(
  baseline: 'udp' | 'dot',
  candidate: 'udp' | 'dot' | 'doh',
  candidateLatency: number,
): ProtocolDeltaPair {
  const candidateMedian = candidateLatency
  const baselineMedian = baseline === 'udp' ? 12.3 : 11.5
  return {
    baseline_protocol: baseline,
    candidate_protocol: candidate,
    rows: [
      {
        resolver: '1.1.1.1',
        baseline: { median_ms: baselineMedian, p95_ms: baselineMedian * 1.4, success_rate: 1, failure_rate: 0, blocking_efficacy: null, score_total: 0.91 },
        candidate: { median_ms: candidateMedian, p95_ms: candidateMedian * 1.4, success_rate: 1, failure_rate: 0, blocking_efficacy: null, score_total: 0.93 },
        deltas: { median_ms: Number((candidateMedian - baselineMedian).toFixed(2)), p95_ms: Number(((candidateMedian - baselineMedian) * 1.4).toFixed(2)), success_rate: 0, failure_rate: 0, blocking_efficacy: null, score_total: 0.02 },
      },
      {
        resolver: '9.9.9.9',
        baseline: null,
        candidate: null,
        deltas: { median_ms: null, p95_ms: null, success_rate: null, failure_rate: null, blocking_efficacy: null, score_total: null },
      },
    ],
  }
}

export function protocolComparisonStatusFixture(
  comparisonId: string,
  options: {
    status?: ProtocolComparisonStatus['status']
    complete?: boolean
    subruns?: ProtocolSubrunResult[]
    deltaPairs?: ProtocolDeltaPair[]
  } = {},
): ProtocolComparisonStatus {
  const subruns = options.subruns ?? [protocolSubrunFixture('udp', 'done'), protocolSubrunFixture('dot', 'done')]
  const running = options.status === 'queued' || options.status === 'running'
  const done = options.status === 'done' || options.status === undefined
  return {
    comparison_id: comparisonId,
    status: options.status ?? 'done',
    complete: options.complete ?? (done && subruns.every((subrun) => subrun.status === 'done')),
    error: null,
    run_storage_warning: null,
    progress: running
      ? { current: 60, total: 246, current_protocol: subruns[0]?.protocol ?? null, current_resolver: '1.1.1.1', last_sample_at: Date.now(), avg_latency_ms: 14.2 }
      : { current: 246, total: 246, current_protocol: null, current_resolver: null, last_sample_at: null, avg_latency_ms: 14.2 },
    manifest: protocolComparisonManifest(comparisonId, subruns.map((subrun) => subrun.protocol)),
    exclusions: [],
    subruns,
    delta_pairs: options.deltaPairs ?? [protocolDeltaPairFixture('udp', 'dot', 11.5)],
  }
}

export function protocolComparisonPartialFixture(comparisonId: string): ProtocolComparisonStatus {
  return {
    comparison_id: comparisonId,
    status: 'done',
    complete: false,
    error: null,
    run_storage_warning: null,
    progress: { current: 160, total: 369, current_protocol: null, current_resolver: null, last_sample_at: null, avg_latency_ms: 14.2 },
    manifest: protocolComparisonManifest(comparisonId, ['udp', 'dot', 'doh']),
    exclusions: [],
    subruns: [
      protocolSubrunFixture('udp', 'done'),
      protocolSubrunFixture('dot', 'failed', 'dot transport exploded'),
      protocolSubrunFixture('doh', 'done'),
    ],
    delta_pairs: [
      { ...protocolDeltaPairFixture('udp', 'dot', 11.5), rows: protocolDeltaPairFixture('udp', 'dot', 11.5).rows },
      { ...protocolDeltaPairFixture('udp', 'doh', 20.1), rows: protocolDeltaPairFixture('udp', 'doh', 20.1).rows },
    ],
  }
}

export function probeFixture(recommendedMedianMs = 12.0): ProbeResponse {
  const now = new Date().toISOString()
  return {
    engine: 'drill',
    timeout_sec: 1.5,
    runs_per_resolver: 4,
    queried_at: now,
    results: [
      {
        resolver: '9.9.9.9',
        provider_id: 'quad9',
        provider_name: 'Quad9',
        engine: 'drill',
        stats: makeStats(recommendedMedianMs),
        samples: [],
      },
      {
        resolver: '1.1.1.1',
        provider_id: 'cloudflare',
        provider_name: 'Cloudflare',
        engine: 'drill',
        stats: makeStats(12.0),
        samples: [],
      },
      {
        resolver: '192.168.1.1',
        provider_id: 'isp-detectado',
        provider_name: 'ISP (Detectado)',
        engine: 'drill',
        stats: makeStats(42.0),
        samples: [],
      },
    ],
  }
}
