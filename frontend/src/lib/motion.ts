export interface LiveMotionPolicy {
  isMotionBudgetExceeded: boolean
  allowReorderAnimation: boolean
  allowHighlights: boolean
  updatedLabelIntervalMs: number
}

export function resolveLiveMotionPolicy(
  rowCount: number,
  motionRowBudget: number,
  prefersReducedMotion: boolean,
): LiveMotionPolicy {
  const normalizedBudget = Math.max(1, Math.floor(motionRowBudget))
  const isMotionBudgetExceeded = rowCount > normalizedBudget
  const allowReorderAnimation = !prefersReducedMotion && !isMotionBudgetExceeded
  const allowHighlights = !isMotionBudgetExceeded
  const updatedLabelIntervalMs = isMotionBudgetExceeded || prefersReducedMotion ? 1000 : 500

  return {
    isMotionBudgetExceeded,
    allowReorderAnimation,
    allowHighlights,
    updatedLabelIntervalMs,
  }
}
