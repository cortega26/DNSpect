import { describe, expect, it } from 'vitest'

import { resolveLiveMotionPolicy } from './motion'

describe('live motion budget policy', () => {
  it('disables reorder animation when row count exceeds budget', () => {
    const policy = resolveLiveMotionPolicy(45, 30, false)
    expect(policy.isMotionBudgetExceeded).toBe(true)
    expect(policy.allowReorderAnimation).toBe(false)
    expect(policy.allowHighlights).toBe(false)
    expect(policy.updatedLabelIntervalMs).toBe(1000)
  })

  it('disables reorder animation in reduced-motion mode', () => {
    const policy = resolveLiveMotionPolicy(10, 30, true)
    expect(policy.isMotionBudgetExceeded).toBe(false)
    expect(policy.allowReorderAnimation).toBe(false)
    expect(policy.allowHighlights).toBe(true)
    expect(policy.updatedLabelIntervalMs).toBe(1000)
  })
})
