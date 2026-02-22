import { describe, expect, it } from 'vitest'

import { computeRunningEtaText } from './eta'

const t = () => 'estimate unavailable'

describe('computeRunningEtaText', () => {
  it('returns fallback and does not throw when progress is undefined', () => {
    const result = computeRunningEtaText({ status: 'running', progress: undefined, timeout_sec: 2 }, 2, t)
    expect(result).toBe('estimate unavailable')
  })

  it('returns fallback and does not throw when progress is null', () => {
    const result = computeRunningEtaText({ status: 'running', progress: null, timeout_sec: 2 }, 2, t)
    expect(result).toBe('estimate unavailable')
  })

  it('returns a non-empty ETA string for valid running progress', () => {
    const result = computeRunningEtaText({ status: 'running', progress: { total: 10, current: 1 }, timeout_sec: 2 }, 2, t)
    expect(result).toBeTruthy()
    expect(result).not.toBe('estimate unavailable')
  })
})
