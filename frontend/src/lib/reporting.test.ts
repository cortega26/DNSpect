import { describe, expect, it } from 'vitest'

import type { BenchmarkStatus, ResolverResult } from './types'
import {
  LAST_RUN_SCHEMA_VERSION,
  LAST_RUN_STORAGE_KEY,
  buildResultsCsv,
  buildShareSummary,
  deserializeSavedLastRun,
  loadSavedLastRun,
  serializeSavedLastRun,
} from './reporting'

const csvBaseColumns = [
  'resolver',
  'provider_id',
  'provider_name',
  'engine',
  'protocol',
  'avg_ms',
  'median_ms',
  'p95_ms',
  'min_ms',
  'max_ms',
  'ok_count',
  'timeout_count',
  'success_rate',
  'timeout_rate',
  'success_count',
  'failure_count',
  'failure_rate',
  'consistency_ratio',
  'p95_minus_median_ms',
  'score_latency',
  'score_reliability',
  'score_stability',
  'score_total',
  'normalized_latency',
  'normalized_reliability',
  'normalized_stability',
  'reliability_penalty',
  'max_rel_penalty',
  'blocking_efficacy',
  'blocked_count',
  'blocking_test_count',
  'score_blocking',
  'normalized_blocking',
  'is_unreliable',
]

function sampleResult(overrides: Partial<ResolverResult> = {}): ResolverResult {
  return {
    resolver: '1.1.1.1',
    provider_id: 'cloudflare',
    provider_name: 'Cloudflare',
    engine: 'drill',
    protocol: 'udp',
    samples: [],
    stats: {
      avg_ms: 24.5,
      median_ms: 24.1,
      p95_ms: 35.1,
      min_ms: 20,
      max_ms: 40,
      ok_count: 30,
      timeout_count: 0,
      success_rate: 1,
      timeout_rate: 0,
      success_count: 30,
      failure_count: 0,
      failure_rate: 0,
      consistency_ratio: 0.98,
      p95_minus_median_ms: 11,
      score_latency: 24.5,
      score_reliability: 0,
      score_stability: 11,
      score_total: 11.1,
      normalized_latency: 0.01,
      normalized_reliability: 0,
      normalized_stability: 0.02,
      reliability_penalty: 0,
      max_rel_penalty: 0.3,
      blocking_efficacy: null,
      blocked_count: 0,
      blocking_test_count: 0,
      score_blocking: null,
      normalized_blocking: null,
    },
    ...overrides,
  }
}

function sampleStatus(results: ResolverResult[]): BenchmarkStatus {
  return {
    id: 'bench-1',
    status: 'done',
    progress: {
      current: 30,
      total: 30,
      current_resolver: null,
    },
    started_at: '2026-02-21T10:00:00Z',
    finished_at: '2026-02-21T10:01:00Z',
    mode: 'quick',
    protocol: 'udp',
    timeout_sec: 2,
    runs: 30,
    engine: 'drill',
    error: null,
    results,
    recommended_resolver: results[0]?.resolver ?? null,
    recommendation_warning: null,
  }
}

function t(key: string, params?: Record<string, number | string>): string {
  const dict: Record<string, string> = {
    'summary.na': 'N/A',
    'share.header': 'DNSpect results ({{date}})',
    'share.recommended': 'Recommended',
    'share.current': 'Current',
    'share.improvement': 'Latency improvement',
    'share.reliability': 'Reliability',
    'share.warning': 'Warning',
    'share.top5': 'Top 5',
    'share.improvementUnavailable': 'Unavailable',
    'share.improvementFaster': '{{ms}}ms faster',
    'share.improvementSlower': '{{ms}}ms slower',
    'share.improvementEqual': 'No latency change',
  }
  const template = dict[key] ?? key
  if (!params) return template
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token: string) => String(params[token] ?? ''))
}

describe('saved run serialization', () => {
  it('serializes and deserializes a saved run envelope', () => {
    const payload = sampleStatus([sampleResult()])
    const serialized = serializeSavedLastRun({
      payload,
      metadata: {
        timestamp: '2026-02-21T10:02:00Z',
        platform: 'linux',
        app_version: '1.0.1',
      },
    })

    const restored = deserializeSavedLastRun(serialized)
    expect(restored).not.toBeNull()
    expect(restored?.metadata.timestamp).toBe('2026-02-21T10:02:00Z')
    expect(restored?.payload.id).toBe('bench-1')
    expect(restored?.payload.results?.[0]?.resolver).toBe('1.1.1.1')
  })

  it('returns null for malformed payload', () => {
    expect(deserializeSavedLastRun('not-json')).toBeNull()
    expect(deserializeSavedLastRun(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })

  it('invalidates old schema payloads safely', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    }
    storage.setItem(
      LAST_RUN_STORAGE_KEY,
      JSON.stringify({
        schema_version: LAST_RUN_SCHEMA_VERSION + 1,
        payload: sampleStatus([sampleResult()]),
        metadata: {
          timestamp: '2026-02-21T10:02:00Z',
          platform: 'linux',
          app_version: '1.0.1',
        },
      }),
    )

    const loaded = loadSavedLastRun(storage)
    expect(loaded.saved).toBeNull()
    expect(loaded.invalidationReason).toBe('schema_version_mismatch')
    expect(storage.getItem(LAST_RUN_STORAGE_KEY)).toBeNull()
  })

  it('invalidates legacy payloads without schema_version', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    }
    storage.setItem(
      LAST_RUN_STORAGE_KEY,
      JSON.stringify({
        payload: sampleStatus([sampleResult()]),
        metadata: {
          timestamp: '2026-02-21T10:02:00Z',
          platform: 'linux',
          app_version: '1.0.1',
        },
      }),
    )

    const loaded = loadSavedLastRun(storage)
    expect(loaded.saved).toBeNull()
    expect(loaded.invalidationReason).toBe('schema_version_mismatch')
    expect(storage.getItem(LAST_RUN_STORAGE_KEY)).toBeNull()
  })

  it('invalidates malformed payloads safely', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    }
    storage.setItem(LAST_RUN_STORAGE_KEY, JSON.stringify({ schema_version: LAST_RUN_SCHEMA_VERSION, payload: {} }))

    const loaded = loadSavedLastRun(storage)
    expect(loaded.saved).toBeNull()
    expect(loaded.invalidationReason).toBe('malformed_payload')
    expect(storage.getItem(LAST_RUN_STORAGE_KEY)).toBeNull()
  })
})

describe('CSV export generation', () => {
  it('keeps stable base column order and appends extra keys deterministically', () => {
    const result = sampleResult({
      provider_name: 'Cloudflare, "Primary"',
    }) as ResolverResult & Record<string, unknown>
    ;(result.stats as unknown as Record<string, unknown>).z_metric = 9
    ;(result.stats as unknown as Record<string, unknown>).a_metric = 1
    result.custom_tag = 'edge'

    const csv = buildResultsCsv([result as ResolverResult])
    const [header, row] = csv.split('\n')
    const headerColumns = header.slice(1, -1).split('","')

    expect(headerColumns.slice(0, csvBaseColumns.length)).toEqual(csvBaseColumns)
    expect(headerColumns.slice(csvBaseColumns.length)).toEqual(['a_metric', 'z_metric', 'custom_tag'])
    expect(row).toContain('"Cloudflare, ""Primary"""')
  })

  it('keeps raw numeric output with dot decimal and no locale formatting', () => {
    const csv = buildResultsCsv([sampleResult({ stats: { ...sampleResult().stats, avg_ms: 24.5, p95_ms: 35.125 } })])
    const [, row] = csv.split('\n')

    expect(row).toContain('"24.5"')
    expect(row).toContain('"35.125"')
    expect(row.includes('"24,5"')).toBe(false)
  })
})

describe('share summary formatting', () => {
  it('builds a readable summary with warning and top 5 lines', () => {
    const results = [
      sampleResult(),
      sampleResult({ resolver: '8.8.8.8', provider_name: 'Google', provider_id: 'google' }),
      sampleResult({ resolver: '9.9.9.9', provider_name: 'Quad9', provider_id: 'quad9' }),
      sampleResult({ resolver: '208.67.222.222', provider_name: 'OpenDNS', provider_id: 'opendns' }),
      sampleResult({ resolver: '76.76.2.0', provider_name: 'Control D', provider_id: 'controld' }),
    ]
    const status = sampleStatus(results)
    status.recommendation_warning = 'All resolvers exceed reliability threshold.'

    const summary = buildShareSummary({
      status,
      language: 'en',
      t: (key, params) => t(key, params),
      recommended: results[0],
      currentResolver: 'ISP DNS (200.28.4.130)',
      improvementMs: 58,
    })

    expect(summary).toContain('DNSpect results (')
    expect(summary).toContain('Recommended: Cloudflare (1.1.1.1)')
    expect(summary).toContain('Current: ISP DNS (200.28.4.130)')
    expect(summary).toContain('Latency improvement: 58ms faster')
    expect(summary).toContain('Warning: All resolvers exceed reliability threshold.')
    expect(summary).toContain('Top 5:')
    expect(summary).toContain('1. Cloudflare (1.1.1.1)')
    expect(summary).toContain('5. Control D (76.76.2.0)')
  })
})
