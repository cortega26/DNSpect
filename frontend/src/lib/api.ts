import type { BenchmarkMode, BenchmarkProtocol, BenchmarkStatus, Goal, ProbeResponse, Provider, ProtocolComparisonPreflight, ProtocolComparisonStartPayload, ProtocolComparisonStatus, RunComparisonResponse, ScoringProfile, SystemDnsPayload, TargetSnapshot, WatchConfigPayload, WatchListResponse } from './types'
import { API_BASE } from './utils'

interface StartBenchmarkPayload {
  mode: BenchmarkMode
  goal?: Goal
  scoring_profile?: ScoringProfile
  protocol?: BenchmarkProtocol
  runs?: number
  timeout_sec: number
  resolvers: string[]
  queries?: string[]
  target_snapshot?: TargetSnapshot | null
}

interface ProbePayload {
  resolvers: string[]
  queries?: string[]
  timeout_sec?: number
  runs_per_resolver?: number
}

export async function getProviders(): Promise<Provider[]> {
  const res = await fetch(`${API_BASE}/api/providers`)
  if (!res.ok) throw new Error('No se pudo cargar /api/providers')
  return res.json()
}

export interface Capabilities {
  doq: boolean
}

export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const res = await fetch(`${API_BASE}/api/health`, { signal })
  if (!res.ok) throw new Error('No se pudo cargar /api/health')
  const body = await res.json()
  return (body.capabilities ?? { doq: false }) as Capabilities
}

export async function getSystemDns(signal?: AbortSignal): Promise<SystemDnsPayload> {
  const res = await fetch(`${API_BASE}/api/dns/system`, { signal })
  if (!res.ok) throw new Error('No se pudo cargar /api/dns/system')
  return res.json()
}

export interface GeoIpResult {
  country_code: string | null
  country_name: string | null
  region: string | null
  city: string | null
  source: string | null
}

export async function lookupGeoIp(ip: string, signal?: AbortSignal): Promise<GeoIpResult> {
  const res = await fetch(`${API_BASE}/api/geoip?ip=${encodeURIComponent(ip)}`, { signal })
  if (!res.ok) return { country_code: null, country_name: null, region: null, city: null, source: null }
  return res.json()
}

export async function getPublicIp(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: signal ?? AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.ip === 'string' ? data.ip : null
  } catch {
    return null
  }
}

export async function startBenchmark(payload: StartBenchmarkPayload): Promise<{ benchmark_id: string }> {
  const body: Record<string, unknown> = {
    mode: payload.mode,
    scoring_profile: payload.scoring_profile ?? payload.goal ?? 'speed',
    protocol: payload.protocol ?? 'udp',
    timeout_sec: payload.timeout_sec,
    resolvers: payload.resolvers,
  }
  if (payload.runs !== undefined) body.runs = payload.runs
  if (payload.queries && payload.queries.length > 0) body.queries = payload.queries
  if (payload.target_snapshot) body.target_snapshot = payload.target_snapshot

  const res = await fetch(`${API_BASE}/api/benchmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await safeError(res)
    throw new Error(detail)
  }
  return res.json()
}

export interface RunHistoryEntry {
  id: string
  mode: string
  goal?: string | null
  scoring_profile?: string | null
  protocol: string | null
  started_at: string
  finished_at: string | null
  status: string
  results_summary: Array<{ provider_name: string; resolver: string }>
  target_snapshot?: TargetSnapshot | null
  origin?: 'watch' | null
}

export interface RunHistoryResponse {
  runs: RunHistoryEntry[]
}

export async function getBenchmarkHistory(signal?: AbortSignal): Promise<RunHistoryResponse> {
  const res = await fetch(`${API_BASE}/api/benchmarks/history`, { signal })
  if (!res.ok) throw new Error('No se pudo cargar historial')
  return res.json()
}

export async function getBenchmark(id: string, includeSamples = false, signal?: AbortSignal): Promise<BenchmarkStatus> {
  const suffix = includeSamples ? '?include_samples=1' : ''
  const res = await fetch(`${API_BASE}/api/benchmarks/${id}${suffix}`, { signal })
  if (!res.ok) throw new Error('No se pudo consultar benchmark')
  return res.json()
}

export async function compareRuns(
  baselineId: string,
  candidateId: string,
  signal?: AbortSignal,
): Promise<RunComparisonResponse> {
  const query = new URLSearchParams({ baseline_id: baselineId, candidate_id: candidateId })
  const res = await fetch(`${API_BASE}/api/benchmarks/compare?${query.toString()}`, { signal })
  if (!res.ok) throw new Error('No se pudo comparar')
  return res.json()
}

export async function preflightProtocolComparison(
  payload: ProtocolComparisonStartPayload,
  signal?: AbortSignal,
): Promise<ProtocolComparisonPreflight> {
  const res = await fetch(`${API_BASE}/api/protocol-comparisons/preflight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok) {
    const detail = await safeError(res)
    throw new Error(detail)
  }
  return res.json()
}

export async function startProtocolComparison(
  payload: ProtocolComparisonStartPayload,
): Promise<{ comparison_id: string }> {
  const res = await fetch(`${API_BASE}/api/protocol-comparisons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await safeError(res)
    throw new Error(detail)
  }
  return res.json()
}

export async function getProtocolComparison(
  comparisonId: string,
  signal?: AbortSignal,
): Promise<ProtocolComparisonStatus> {
  const res = await fetch(`${API_BASE}/api/protocol-comparisons/${comparisonId}`, { signal })
  if (!res.ok) throw new Error('No se pudo consultar comparación')
  return res.json()
}

export async function probeResolvers(payload: ProbePayload, signal?: AbortSignal): Promise<ProbeResponse> {
  const body: Record<string, unknown> = {
    resolvers: payload.resolvers,
  }
  if (payload.queries && payload.queries.length > 0) body.queries = payload.queries
  if (payload.timeout_sec !== undefined) body.timeout_sec = payload.timeout_sec
  if (payload.runs_per_resolver !== undefined) body.runs_per_resolver = payload.runs_per_resolver

  const res = await fetch(`${API_BASE}/api/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const detail = await safeError(res)
    throw new Error(detail)
  }
  return res.json()
}

export async function getWatches(signal?: AbortSignal): Promise<WatchListResponse> {
  const res = await fetch(`${API_BASE}/api/watch`, { signal })
  if (!res.ok) throw new Error('No se pudo cargar los watches')
  return res.json()
}

export async function createWatch(payload: WatchConfigPayload): Promise<{ watch_id: string }> {
  const res = await fetch(`${API_BASE}/api/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = await safeError(res)
    throw new Error(detail)
  }
  return res.json()
}

export async function deleteWatch(watchId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/watch/${watchId}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = await safeError(res)
    throw new Error(detail)
  }
}

export async function safeError(res: Response): Promise<string> {
  try {
    const payload = await res.json()
    if (payload?.detail) return String(payload.detail)
  } catch {
    // ignore
  }
  return `Error HTTP ${res.status}`
}
