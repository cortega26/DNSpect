export type BenchmarkMode = 'quick' | 'standard' | 'exhaustive'

export interface ProviderFeatures {
  filtering: string
  malware_protection: string
  family: string
  doh: string
  dot: string
}

export interface Provider {
  id: string
  name: string
  dns: string[]
  tags: string[]
  features: ProviderFeatures
  notes_es: string
}

export interface SystemDnsPayload {
  resolvers: string[]
  method: string
  platform: string
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
  consistency_ratio: number | null
  p95_minus_median_ms: number | null
}

export interface ResolverResult {
  resolver: string
  provider_id: string
  provider_name: string
  engine: string
  stats: ResolverStats
  samples: Sample[]
  sample_count?: number
}

export interface BenchmarkStatus {
  id: string
  status: 'running' | 'done' | 'error'
  progress: {
    current: number
    total: number
    current_resolver: string | null
  }
  started_at: string
  finished_at: string | null
  mode: BenchmarkMode
  timeout_sec: number
  runs: number
  engine: string | null
  error: string | null
  results: ResolverResult[] | null
}
