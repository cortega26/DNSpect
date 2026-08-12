import { describe, expect, it } from 'vitest'

import type { RunHistoryEntry } from './api'

import { isWatchRun, latestUserRun } from './utils'

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
