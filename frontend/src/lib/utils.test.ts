import { describe, expect, it } from 'vitest'

import type { RunHistoryEntry } from './api'
import type { TargetScope } from './targetScope'
import type { Provider, ResolverResult, ResolverStats } from './types'

import {
  fmtMs,
  isWatchRun,
  latestUserRun,
  providersByGoal,
  regionLabelKey,
  resolverBlockingScore,
  resolverGroup,
  resolverReliabilityScore,
} from './utils'

function entry(
  id: string,
  startedAt: string,
  status = 'done',
  origin?: 'watch' | null,
): RunHistoryEntry {
  return {
    id,
    mode: 'quick',
    protocol: 'udp',
    started_at: startedAt,
    finished_at: null,
    status,
    results_summary: [],
    origin,
  }
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p',
    name: 'P',
    dns: ['1.1.1.1'],
    tags: [],
    region: 'global',
    country: null,
    goals: ['speed'],
    features: { filtering: 'no', malware_protection: 'no', family: 'no', doh: 'no', dot: 'no' },
    notes_es: '',
    ...overrides,
  }
}

function result(stats: Partial<ResolverStats> = {}): ResolverResult {
  return {
    resolver: '1.1.1.1',
    provider_id: 'p',
    provider_name: 'P',
    engine: 'dnspython',
    protocol: 'udp',
    samples: [],
    stats: {
      avg_ms: null,
      median_ms: null,
      p95_ms: null,
      min_ms: null,
      max_ms: null,
      ok_count: 0,
      timeout_count: 0,
      success_rate: 0,
      timeout_rate: 0,
      success_count: 0,
      failure_count: 0,
      failure_rate: 0,
      consistency_ratio: null,
      p95_minus_median_ms: null,
      score_latency: null,
      score_reliability: 0,
      score_stability: null,
      score_total: null,
      blocking_efficacy: null,
      blocked_count: 0,
      blocking_test_count: 0,
      score_blocking: null,
      normalized_blocking: null,
      ...stats,
    },
  }
}

describe('isWatchRun', () => {
  it('is true only for the watch origin', () => {
    expect(isWatchRun({ origin: 'watch' })).toBe(true)
    expect(isWatchRun({ origin: null })).toBe(false)
    expect(isWatchRun({})).toBe(false)
  })

  it('is null-safe', () => {
    expect(isWatchRun(null)).toBe(false)
    expect(isWatchRun(undefined)).toBe(false)
  })
})

describe('latestUserRun', () => {
  it('picks the newest done user run', () => {
    const history = [
      entry('old', '2026-01-01T00:00:00Z'),
      entry('new', '2026-01-03T00:00:00Z'),
      entry('mid', '2026-01-02T00:00:00Z'),
    ]
    expect(latestUserRun(history)?.id).toBe('new')
  })

  it('skips watch runs', () => {
    const history = [
      entry('watch', '2026-01-03T00:00:00Z', 'done', 'watch'),
      entry('user', '2026-01-02T00:00:00Z'),
    ]
    expect(latestUserRun(history)?.id).toBe('user')
  })

  it('returns null when only watch runs exist', () => {
    const history = [entry('watch', '2026-01-03T00:00:00Z', 'done', 'watch')]
    expect(latestUserRun(history)).toBeNull()
  })

  it('returns null on empty history', () => {
    expect(latestUserRun([])).toBeNull()
  })

  it('skips non-done entries', () => {
    const history = [
      entry('running', '2026-01-03T00:00:00Z', 'running'),
      entry('done', '2026-01-02T00:00:00Z'),
    ]
    expect(latestUserRun(history)?.id).toBe('done')
  })
})

describe('fmtMs', () => {
  it.each([
    [19.5, '19.50 ms'],
    [0, '0.00 ms'],
    [19, '19.00 ms'],
  ] as const)('formats %s as %s', (value, expected) => {
    expect(fmtMs(value)).toBe(expected)
  })

  it('returns NA for null and NaN', () => {
    expect(fmtMs(null)).toBe('NA')
    expect(fmtMs(NaN)).toBe('NA')
  })
})

describe('providersByGoal', () => {
  const speed = provider({ id: 'a', goals: ['speed'] })
  const security = provider({ id: 'b', goals: ['security'] })
  const detected = provider({ id: 'isp-detectado', goals: [] })

  it('returns all providers for the speed goal', () => {
    expect(providersByGoal([speed, security], 'speed')).toEqual([speed, security])
  })

  it('filters to matching goals and always keeps isp-detectado', () => {
    expect(providersByGoal([speed, security, detected], 'security')).toEqual([security, detected])
  })

  it('returns an empty array for no providers', () => {
    expect(providersByGoal([], 'privacy')).toEqual([])
  })
})

describe('regionLabelKey', () => {
  it('maps every known scope to its translation key', () => {
    expect(regionLabelKey('all')).toBe('region.all')
    expect(regionLabelKey('global')).toBe('region.global')
    expect(regionLabelKey('europe')).toBe('region.europe')
    expect(regionLabelKey('south-america')).toBe('region.southAmerica')
    expect(regionLabelKey('north-america')).toBe('region.northAmerica')
    expect(regionLabelKey('asia')).toBe('region.asia')
  })

  it('falls back to region.auto for null, unknown, and empty scope', () => {
    expect(regionLabelKey(null)).toBe('region.auto')
    expect(regionLabelKey('unknown')).toBe('region.auto')
    expect(regionLabelKey('africa' as TargetScope)).toBe('region.auto')
  })
})

describe('resolverGroup', () => {
  it('returns Global for missing providers', () => {
    expect(resolverGroup(undefined)).toBe('Global')
    expect(resolverGroup()).toBe('Global')
  })

  it('prioritizes detection and privacy tags', () => {
    expect(resolverGroup(provider({ tags: ['isp_detectado'] }))).toBe('ISP detectados')
    expect(resolverGroup(provider({ tags: ['privacidad'] }))).toBe('Privacidad')
  })

  it('uses country, then region, for non-global providers', () => {
    expect(resolverGroup(provider({ region: 'south-america', country: 'cl' }))).toBe('CL')
    expect(resolverGroup(provider({ region: 'europe', country: null }))).toBe('europe')
  })

  it('returns Global for global or unknown-region providers', () => {
    expect(resolverGroup(provider({ region: 'global' }))).toBe('Global')
    expect(resolverGroup(provider({ region: null, tags: [] }))).toBe('Global')
  })
})

describe('resolverReliabilityScore', () => {
  it.each([
    [{ failure_rate: 0.1 }, 0.9],
    [{ failure_rate: 0 }, 1],
    [{ failure_rate: -0.5 }, 1],
    [{ failure_rate: 1.2 }, 0],
  ] as const)('maps failure_rate %o to %s', (stats, expected) => {
    expect(resolverReliabilityScore(result(stats))).toBe(expected)
  })

  it('falls back to success_rate when failure_rate is not finite', () => {
    expect(resolverReliabilityScore(result({ failure_rate: NaN, success_rate: 0.8 }))).toBe(0.8)
  })

  it('returns 0 when neither rate is finite', () => {
    expect(resolverReliabilityScore(result({ failure_rate: NaN, success_rate: NaN }))).toBe(0)
  })
})

describe('resolverBlockingScore', () => {
  it.each([
    [{ blocking_efficacy: 0.4 }, 0.4],
    [{ blocking_efficacy: 1 }, 1],
    [{ blocking_efficacy: 1.5 }, 1],
    [{ blocking_efficacy: -0.2 }, 0],
  ] as const)('clamps blocking_efficacy %o to %s', (stats, expected) => {
    expect(resolverBlockingScore(result(stats))).toBe(expected)
  })

  it('returns 0 for null or NaN efficacy', () => {
    expect(resolverBlockingScore(result({ blocking_efficacy: null }))).toBe(0)
    expect(resolverBlockingScore(result({ blocking_efficacy: NaN }))).toBe(0)
  })
})
