import type { BenchmarkMode, BenchmarkStatus, ProbeResponse, Provider, SystemDnsPayload } from './types'
import { API_BASE } from './utils'

interface StartBenchmarkPayload {
  mode: BenchmarkMode
  runs?: number
  timeout_sec: number
  resolvers: string[]
  queries?: string[]
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

export async function getSystemDns(): Promise<SystemDnsPayload> {
  const res = await fetch(`${API_BASE}/api/dns/system`)
  if (!res.ok) throw new Error('No se pudo cargar /api/dns/system')
  return res.json()
}

export async function startBenchmark(payload: StartBenchmarkPayload): Promise<{ benchmark_id: string }> {
  const body: Record<string, unknown> = {
    mode: payload.mode,
    timeout_sec: payload.timeout_sec,
    resolvers: payload.resolvers,
  }
  if (payload.runs !== undefined) body.runs = payload.runs
  if (payload.queries && payload.queries.length > 0) body.queries = payload.queries

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

export async function getBenchmark(id: string, includeSamples = false, signal?: AbortSignal): Promise<BenchmarkStatus> {
  const suffix = includeSamples ? '?include_samples=1' : ''
  const res = await fetch(`${API_BASE}/api/benchmarks/${id}${suffix}`, { signal })
  if (!res.ok) throw new Error('No se pudo consultar benchmark')
  return res.json()
}

export async function probeResolvers(payload: ProbePayload): Promise<ProbeResponse> {
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
  })
  if (!res.ok) {
    const detail = await safeError(res)
    throw new Error(detail)
  }
  return res.json()
}

async function safeError(res: Response): Promise<string> {
  try {
    const payload = await res.json()
    if (payload?.detail) return String(payload.detail)
  } catch {
    // ignore
  }
  return `Error HTTP ${res.status}`
}
