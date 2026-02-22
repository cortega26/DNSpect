export interface StallThresholds {
  slowMs: number
  stalledMs: number
}

const DEFAULT_TIMEOUT_SEC = 2
const SMALL_IMPROVEMENT_FLOOR_MS = 5
const SMALL_IMPROVEMENT_RATIO = 0.05

function normalizeTimeoutSec(timeoutSec: number | null | undefined): number {
  if (!Number.isFinite(timeoutSec) || timeoutSec === null || timeoutSec === undefined || timeoutSec <= 0) {
    return DEFAULT_TIMEOUT_SEC
  }
  return timeoutSec
}

export function computeStallThresholds(timeoutSec: number | null | undefined): StallThresholds {
  const timeoutMs = normalizeTimeoutSec(timeoutSec) * 1000
  return {
    slowMs: Math.round(timeoutMs * 1.5),
    stalledMs: Math.round(timeoutMs * 2.5),
  }
}

export function isSmallImprovement(improvementMs: number | null, currentAverageMs: number | null): boolean {
  if (improvementMs === null || !Number.isFinite(improvementMs) || improvementMs <= 0) return false
  const currentBase = Number.isFinite(currentAverageMs) && currentAverageMs !== null && currentAverageMs > 0 ? currentAverageMs : 0
  const threshold = Math.max(SMALL_IMPROVEMENT_FLOOR_MS, currentBase * SMALL_IMPROVEMENT_RATIO)
  return improvementMs < threshold
}

export function shouldPollBenchmark(benchmarkId: string | null, viewingSavedRun: boolean): benchmarkId is string {
  return !viewingSavedRun && typeof benchmarkId === 'string' && benchmarkId.length > 0
}

export function shouldAcceptAsyncResult(requestSeq: number, latestRequestSeq: number, isMounted: boolean): boolean {
  return isMounted && requestSeq === latestRequestSeq
}

export function isActivePollSession(
  sessionId: number,
  activeSessionId: number,
  benchmarkId: string,
  activeBenchmarkId: string | null,
): boolean {
  return sessionId === activeSessionId && benchmarkId === activeBenchmarkId
}
