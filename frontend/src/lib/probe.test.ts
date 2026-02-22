import { describe, expect, it } from 'vitest'

import { compareProbeSummaries, parseProbeResponse, type ProbeSummary } from './probe'
import type { ProbeResponse, ProbeResult, ResolverStats } from './types'

function stats(overrides: Partial<ResolverStats> = {}): ResolverStats {
  return {
    avg_ms: 22,
    median_ms: 21,
    p95_ms: 30,
    min_ms: 18,
    max_ms: 31,
    ok_count: 4,
    timeout_count: 0,
    success_rate: 1,
    timeout_rate: 0,
    success_count: 4,
    failure_count: 0,
    failure_rate: 0,
    consistency_ratio: 0.92,
    p95_minus_median_ms: 9,
    score_latency: 22,
    score_reliability: 0,
    score_stability: 9,
    score_total: 15,
    normalized_latency: 0.1,
    normalized_reliability: 0,
    normalized_stability: 0.2,
    reliability_penalty: 0,
    max_rel_penalty: 0.3,
    ...overrides,
  }
}

function probeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    resolver: '1.1.1.1',
    provider_id: 'cloudflare',
    provider_name: 'Cloudflare',
    engine: 'dnspython',
    stats: stats(),
    samples: [
      {
        run_index: 1,
        resolver: '1.1.1.1',
        query: 'example.com',
        ok: true,
        ms: 20,
        error: null,
        failure_kind: null,
      },
      {
        run_index: 2,
        resolver: '1.1.1.1',
        query: 'example.com',
        ok: true,
        ms: 22,
        error: null,
        failure_kind: null,
      },
      {
        run_index: 3,
        resolver: '1.1.1.1',
        query: 'example.com',
        ok: false,
        ms: null,
        error: 'timeout',
        failure_kind: 'timeout',
      },
      {
        run_index: 4,
        resolver: '1.1.1.1',
        query: 'example.com',
        ok: true,
        ms: 18,
        error: null,
        failure_kind: null,
      },
    ],
    ...overrides,
  }
}

function payload(results: ProbeResult[]): ProbeResponse {
  return {
    engine: 'dnspython',
    timeout_sec: 1.5,
    runs_per_resolver: 4,
    queried_at: '2026-02-22T10:00:00Z',
    results,
  }
}

describe('probe response parsing', () => {
  it('parses probe summaries by resolver and keeps backend metrics', () => {
    const response = payload([
      probeResult({ resolver: '1.1.1.1', stats: stats({ median_ms: 21, failure_rate: 0.25 }) }),
      probeResult({ resolver: '8.8.8.8', provider_id: 'google', provider_name: 'Google', stats: stats({ median_ms: 34, failure_rate: 0.5 }) }),
    ])

    const parsed = parseProbeResponse(response)
    expect(parsed.get('1.1.1.1')?.medianMs).toBe(21)
    expect(parsed.get('1.1.1.1')?.failureRate).toBe(0.25)
    expect(parsed.get('8.8.8.8')?.providerName).toBe('Google')
  })

  it('falls back to sample parsing when stats are missing', () => {
    const response = payload([
      probeResult({
        resolver: '9.9.9.9',
        stats: stats({ median_ms: null, failure_rate: Number.NaN }),
      }),
    ])

    const parsed = parseProbeResponse(response)
    const summary = parsed.get('9.9.9.9')
    expect(summary?.medianMs).toBe(20)
    expect(summary?.failureRate).toBe(0.25)
  })
})

describe('probe outcome comparison', () => {
  it('classifies better/same/worse from weighted score', () => {
    const response = payload([
      probeResult({ resolver: '1.1.1.1', stats: stats({ median_ms: 20, failure_rate: 0 }) }),
      probeResult({ resolver: '8.8.8.8', stats: stats({ median_ms: 40, failure_rate: 0.5 }) }),
      probeResult({ resolver: '4.2.2.2', stats: stats({ median_ms: 21, failure_rate: 0 }) }),
    ])

    const parsed = parseProbeResponse(response)
    expect(compareProbeSummaries(parsed.get('1.1.1.1') ?? null, parsed.get('8.8.8.8') ?? null)).toBe('better')
    expect(compareProbeSummaries(parsed.get('1.1.1.1') ?? null, parsed.get('4.2.2.2') ?? null)).toBe('same')
    expect(compareProbeSummaries(parsed.get('8.8.8.8') ?? null, parsed.get('1.1.1.1') ?? null)).toBe('worse')
  })

  it('returns low_confidence when probe latency dispersion is too high', () => {
    const response = payload([
      probeResult({
        resolver: '1.1.1.1',
        stats: stats({ median_ms: 55, failure_rate: 0 }),
        samples: [
          { run_index: 1, resolver: '1.1.1.1', query: 'a.com', ok: true, ms: 10, error: null, failure_kind: null },
          { run_index: 2, resolver: '1.1.1.1', query: 'b.com', ok: true, ms: 95, error: null, failure_kind: null },
          { run_index: 3, resolver: '1.1.1.1', query: 'c.com', ok: true, ms: 20, error: null, failure_kind: null },
          { run_index: 4, resolver: '1.1.1.1', query: 'd.com', ok: true, ms: 85, error: null, failure_kind: null },
        ],
      }),
      probeResult({
        resolver: '8.8.8.8',
        provider_id: 'google',
        provider_name: 'Google',
        stats: stats({ median_ms: 60, failure_rate: 0 }),
        samples: [
          { run_index: 1, resolver: '8.8.8.8', query: 'a.com', ok: true, ms: 58, error: null, failure_kind: null },
          { run_index: 2, resolver: '8.8.8.8', query: 'b.com', ok: true, ms: 60, error: null, failure_kind: null },
          { run_index: 3, resolver: '8.8.8.8', query: 'c.com', ok: true, ms: 62, error: null, failure_kind: null },
          { run_index: 4, resolver: '8.8.8.8', query: 'd.com', ok: true, ms: 61, error: null, failure_kind: null },
        ],
      }),
    ])

    const parsed = parseProbeResponse(response)
    expect(compareProbeSummaries(parsed.get('1.1.1.1') ?? null, parsed.get('8.8.8.8') ?? null)).toBe('low_confidence')
  })

  it('never returns better when the delta stays inside the noise envelope', () => {
    const recommended: ProbeSummary = {
      resolver: '1.1.1.1',
      providerName: 'Cloudflare',
      medianMs: 100,
      failureRate: 0,
      sampleCount: 4,
      successfulSamples: 4,
      latencyIqrMs: 20,
    }
    const current: ProbeSummary = {
      resolver: '8.8.8.8',
      providerName: 'Google',
      medianMs: 118,
      failureRate: 0,
      sampleCount: 4,
      successfulSamples: 4,
      latencyIqrMs: 19,
    }

    // Delta = 18ms, but noise envelope = max(8, 20, 19) = 20ms.
    expect(compareProbeSummaries(recommended, current)).toBe('same')
  })
})
