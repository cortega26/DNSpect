import type { Page, Route } from '@playwright/test'
import type { RunHistoryEntry } from '../../src/lib/api'
import type { BenchmarkStatus, BenchmarkProtocol, ProbeResponse, ProtocolComparisonPreflight, ProtocolComparisonStatus, ProtocolDeltaPair, ProtocolSubrunResult, Provider, ResolverResult, ResolverStats, RunComparisonResponse, RunManifest, SystemDnsPayload } from '../../src/lib/types'

export const APP_ORIGIN = 'http://127.0.0.1:5173'

export const PUBLIC_IP_HOST = 'api.ipify.org'

export const JSON_TYPE = 'application/json'

export interface JsonResponse {
  status?: number
  contentType?: string
  body: unknown
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export interface RouteDeferred extends Deferred<JsonResponse> {
  routeKey: string
  meta: Record<string, string>
}

function isDeferred(value: JsonResponse | Deferred<JsonResponse>): value is Deferred<JsonResponse> {
  return typeof (value as Deferred<JsonResponse>).promise === 'object'
}

function json(body: unknown): JsonResponse {
  return { status: 200, contentType: JSON_TYPE, body }
}

function csv(body: string): JsonResponse {
  return { status: 200, contentType: 'text/csv', body }
}

// ---- Deterministic API fixtures -------------------------------------------------

export const providersFixture: Provider[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    dns: ['1.1.1.1', '1.0.0.1'],
    tags: ['global', 'anycast', 'privacidad'],
    region: 'global',
    country: null,
    goals: ['speed', 'privacy'],
    features: { filtering: 'no', malware_protection: 'no', family: 'no', doh: 'yes', dot: 'yes' },
    notes_es: 'DNS global rápido y muy usado.',
  },
  {
    id: 'google',
    name: 'Google Public DNS',
    dns: ['8.8.8.8', '8.8.4.4'],
    tags: ['global', 'anycast'],
    region: 'global',
    country: null,
    goals: ['speed'],
    features: { filtering: 'no', malware_protection: 'no', family: 'no', doh: 'yes', dot: 'yes' },
    notes_es: 'Servicio DNS global con amplia infraestructura.',
  },
  {
    id: 'quad9',
    name: 'Quad9',
    dns: ['9.9.9.9', '149.112.112.112'],
    tags: ['global', 'privacidad', 'seguridad'],
    region: 'global',
    country: null,
    goals: ['security', 'privacy', 'speed'],
    features: { filtering: 'yes', malware_protection: 'yes', family: 'no', doh: 'yes', dot: 'yes' },
    notes_es: 'Prioriza bloqueo de dominios maliciosos.',
  },
]

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

// ---- Request dispatcher ----------------------------------------------------------

type Handler = (params: Record<string, string>) => JsonResponse | Deferred<JsonResponse>

let benchSeq = 0

const newBenchmarkId = (): string => {
  benchSeq += 1
  return `cafebabe${benchSeq.toString(16).padStart(24, '0')}`
}

let comparisonSeq = 0

const newComparisonId = (): string => {
  comparisonSeq += 1
  return `deadbeef${comparisonSeq.toString(16).padStart(24, '0')}`
}

export class MockApi {
  readonly page: Page
  readonly unhandledRequests: string[] = []
  private readonly handlers = new Map<string, Handler>()
  private readonly counters = new Map<string, number>()
  private readonly deferredList = new Map<string, RouteDeferred[]>()
  private readonly routeDeferreds: RouteDeferred[] = []

  constructor(page: Page) {
    this.page = page
    this.setDefaults()
  }

  private setDefaults(): void {
    this.handlers.set('GET /api/providers', () => json(providersFixture))
    this.handlers.set('GET /api/dns/system', () => json(systemDnsFixture))
    this.handlers.set('GET /api/benchmarks/history', () => json({ runs: [this.historyRunA(), this.historyRunB()] }))
    this.handlers.set('POST /api/benchmarks', () => json({ benchmark_id: newBenchmarkId() }))
    this.handlers.set('GET /api/benchmarks/compare', () => json(comparableComparisonResponse()))
    this.handlers.set('GET /api/benchmarks/:id', (params) => json(runningBenchmark(params.id)))
    this.handlers.set('GET /api/benchmarks/:id/export.csv', () => csv('resolver,provider_name,score_total\n1.1.1.1,Cloudflare,0.97\n'))
    this.handlers.set('POST /api/protocol-comparisons/preflight', () => json(protocolComparisonPreflightFixture()))
    this.handlers.set('POST /api/protocol-comparisons', () => json({ comparison_id: newComparisonId() }))
    this.handlers.set('GET /api/protocol-comparisons/:id', (params) => json(protocolComparisonStatusFixture(params.id, { status: 'running' })))
    this.handlers.set('POST /api/probe', () => json(probeFixture()))
    this.handlers.set('GET /api/geoip', () => json(geoIpFixture))
    this.handlers.set('GET /api/health', () => json({ status: 'ok', version: '1.3.0', backend_time_utc: '2026-08-11T00:00:00Z', capabilities: { doq: false } }))
    this.handlers.set('GET /api/watch', () => json({ watches: [] }))
    this.handlers.set('GET https://api.ipify.org/', () => json(publicIpFixture))
    this.handlers.set('GET https://fonts.googleapis.com/css', () => ({
      status: 200,
      contentType: 'text/css',
      body: '',
    }))
    this.handlers.set('GET https://fonts.gstatic.com/font', () => ({
      status: 404,
      contentType: 'text/plain',
      body: 'font mocked off',
    }))
  }

  private historyRunA(): RunHistoryEntry {
    return historyEntry('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '1.1.1.1', 'Cloudflare', new Date(Date.now() - 3600_000).toISOString())
  }

  private historyRunB(): RunHistoryEntry {
    return historyEntry('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '9.9.9.9', 'Quad9', new Date(Date.now() - 7200_000).toISOString())
  }

  async install(): Promise<void> {
    await this.page.route('**/*', (route) => this.dispatch(route))
  }

  on(routeKey: string, handler: Handler): void {
    this.handlers.set(routeKey, handler)
  }

  /** Create a controlled deferred response for a route; resolved by the test. */
  deferredFor(routeKey: string, meta: Record<string, string> = {}): RouteDeferred {
    const deferred = Object.assign(createDeferred<JsonResponse>(), { routeKey, meta })
    const list = this.deferredList.get(routeKey) ?? []
    list.push(deferred)
    this.deferredList.set(routeKey, list)
    this.routeDeferreds.push(deferred)
    return deferred
  }

  deferredsFor(routeKey: string): RouteDeferred[] {
    return this.deferredList.get(routeKey) ?? []
  }

  countOf(routeKey: string): number {
    return this.counters.get(routeKey) ?? 0
  }

  get allDeferreds(): RouteDeferred[] {
    return this.routeDeferreds
  }

  private count(routeKey: string): void {
    this.counters.set(routeKey, (this.counters.get(routeKey) ?? 0) + 1)
  }

  private async dispatch(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()

    if (url.hostname === PUBLIC_IP_HOST) {
      await this.fulfillOrFail(route, 'GET https://api.ipify.org/', url.pathname, method, {})
      return
    }

    if (url.hostname === 'fonts.googleapis.com') {
      await this.fulfillOrFail(route, 'GET https://fonts.googleapis.com/css', url.pathname, method, {})
      return
    }

    if (url.hostname === 'fonts.gstatic.com') {
      await this.fulfillOrFail(route, 'GET https://fonts.gstatic.com/font', url.pathname, method, {})
      return
    }

    if (!url.pathname.startsWith('/api/')) {
      if (url.origin === APP_ORIGIN) {
        await route.continue()
      } else {
        this.unhandledRequests.push(`${method} ${url.href}`)
        await route.fulfill({ status: 500, contentType: JSON_TYPE, body: JSON.stringify({ error: 'unhandled-external-request' }) })
      }
      return
    }

    const matched = this.resolveKey(method, url.pathname)
    if (!matched) {
      this.unhandledRequests.push(`${method} ${url.pathname}`)
      await route.fulfill({ status: 500, contentType: JSON_TYPE, body: JSON.stringify({ error: 'unhandled-request' }) })
      return
    }
    await this.fulfillOrFail(route, matched.key, url.pathname, method, matched.params)
  }

  private async fulfillOrFail(
    route: Route,
    routeKey: string,
    pathname: string,
    method: string,
    params: Record<string, string>,
  ): Promise<void> {
    const handler = this.handlers.get(routeKey)
    if (!handler) {
      this.unhandledRequests.push(`${method} ${pathname}`)
      await route.fulfill({ status: 500, contentType: JSON_TYPE, body: JSON.stringify({ error: 'unhandled-request' }) })
      return
    }
    this.count(routeKey)
    const result = handler(params)
    const response = isDeferred(result) ? await result.promise : result
    const status = response.status ?? 200
    const contentType = response.contentType ?? JSON_TYPE
    const body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
    await route.fulfill({ status, contentType, body })
  }

  private resolveKey(method: string, pathname: string): { key: string; params: Record<string, string> } | null {
    const exact = `${method} ${pathname}`
    if (this.handlers.has(exact)) return { key: exact, params: {} }
    for (const key of this.handlers.keys()) {
      if (!key.startsWith(`${method} `)) continue
      const pattern = key.slice(method.length + 1)
      const patternSegments = pattern.split('/')
      const pathSegments = pathname.split('/')
      if (patternSegments.length !== pathSegments.length) continue
      const params: Record<string, string> = {}
      let matches = true
      for (let i = 0; i < patternSegments.length; i += 1) {
        const segment = patternSegments[i]
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(pathSegments[i])
        } else if (segment !== pathSegments[i]) {
          matches = false
          break
        }
      }
      if (matches) return { key, params }
    }
    return null
  }
}
