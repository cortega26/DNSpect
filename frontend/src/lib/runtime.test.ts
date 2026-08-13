import { describe, expect, it } from 'vitest'

import {
  computeStallThresholds,
  isActivePollSession,
  isSmallImprovement,
  shouldAcceptAsyncResult,
  shouldPollBenchmark,
  stalenessState,
  terminalRefreshKey,
} from './runtime'

describe('small improvement heuristic', () => {
  it('uses 5ms minimum threshold for low-latency environments', () => {
    expect(isSmallImprovement(4.9, 20)).toBe(true)
    expect(isSmallImprovement(5, 20)).toBe(false)
  })

  it('uses 5% threshold for high-latency environments', () => {
    // 5% of 240ms = 12ms.
    expect(isSmallImprovement(10, 240)).toBe(true)
    expect(isSmallImprovement(12, 240)).toBe(false)
  })
})

describe('stall threshold computation', () => {
  it('scales thresholds from configured timeout', () => {
    expect(computeStallThresholds(2)).toEqual({ slowMs: 3000, stalledMs: 5000 })
    expect(computeStallThresholds(4)).toEqual({ slowMs: 6000, stalledMs: 10000 })
  })
})

describe('staleness state', () => {
  const thresholds = { slowMs: 3000, stalledMs: 5000 }

  it('treats unknown age as fresh', () => {
    expect(stalenessState(null, thresholds)).toBe('fresh')
  })

  it('is fresh below and at the slow boundary', () => {
    expect(stalenessState(0, thresholds)).toBe('fresh')
    expect(stalenessState(2999, thresholds)).toBe('fresh')
    expect(stalenessState(3000, thresholds)).toBe('fresh')
  })

  it('is slow between the slow and stalled boundaries', () => {
    expect(stalenessState(3001, thresholds)).toBe('slow')
    expect(stalenessState(4999, thresholds)).toBe('slow')
    expect(stalenessState(5000, thresholds)).toBe('slow')
  })

  it('is stalled past the stalled boundary', () => {
    expect(stalenessState(5001, thresholds)).toBe('stalled')
    expect(stalenessState(10_000, thresholds)).toBe('stalled')
  })
})

describe('polling guards', () => {
  it('disables polling while viewing a saved run', () => {
    expect(shouldPollBenchmark('bench-live', true)).toBe(false)
    expect(shouldPollBenchmark('bench-live', false)).toBe(true)
  })

  it('rejects stale responses after a rapid restart', () => {
    const staleSessionId = 1
    const staleBenchmarkId = 'bench-a'

    const activeSessionId = 2
    const activeBenchmarkId = 'bench-b'

    expect(isActivePollSession(staleSessionId, activeSessionId, staleBenchmarkId, activeBenchmarkId)).toBe(false)
    expect(isActivePollSession(activeSessionId, activeSessionId, activeBenchmarkId, activeBenchmarkId)).toBe(true)
  })

  it('rejects stale responses after explicit cleanup', () => {
    expect(isActivePollSession(2, 3, 'bench-a', null)).toBe(false)
  })
})

describe('async request sequencing', () => {
  it('accepts only the latest request while mounted', () => {
    expect(shouldAcceptAsyncResult(1, 2, true)).toBe(false)
    expect(shouldAcceptAsyncResult(2, 2, true)).toBe(true)
    expect(shouldAcceptAsyncResult(2, 2, false)).toBe(false)
  })
})

describe('terminal refresh key', () => {
  it('returns key when run first transitions to done', () => {
    expect(terminalRefreshKey({ id: 'abc', status: 'done' }, null)).toBe('abc:done')
  })

  it('returns null for same terminal key already refreshed', () => {
    expect(terminalRefreshKey({ id: 'abc', status: 'done' }, 'abc:done')).toBeNull()
  })

  it('returns null for running status', () => {
    expect(terminalRefreshKey({ id: 'abc', status: 'running' }, null)).toBeNull()
  })

  it('returns null for queued status', () => {
    expect(terminalRefreshKey({ id: 'abc', status: 'queued' }, null)).toBeNull()
  })

  it('returns null for missing id', () => {
    expect(terminalRefreshKey({ status: 'done' }, null)).toBeNull()
    expect(terminalRefreshKey(null, null)).toBeNull()
  })

  it('returns null for same terminal run with same status', () => {
    expect(terminalRefreshKey({ id: 'abc', status: 'done' }, 'abc:done')).toBeNull()
  })

  it('returns new key for failed after done refresh', () => {
    expect(terminalRefreshKey({ id: 'abc', status: 'failed' }, 'abc:done')).toBe('abc:failed')
  })
})
