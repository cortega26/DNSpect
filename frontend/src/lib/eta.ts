export interface RunningStatusLike {
  status?: string | null
  progress?: {
    total?: number | null
    current?: number | null
  } | null
  timeout_sec?: number | null
}

export function formatEtaRange(lowerSec: number, upperSec: number): string {
  const safeLower = Math.max(5, Number.isFinite(lowerSec) ? lowerSec : 5)
  const safeUpper = Math.max(safeLower, Number.isFinite(upperSec) ? upperSec : safeLower)

  if (safeUpper < 60) {
    const lower = Math.max(5, Math.round(safeLower))
    const upper = Math.max(lower, Math.round(safeUpper))
    return lower === upper ? `~${lower} s` : `~${lower}-${upper} s`
  }

  const lowerMin = Math.max(1, Math.floor(safeLower / 60))
  const upperMin = Math.max(lowerMin, Math.ceil(safeUpper / 60))
  return lowerMin === upperMin ? `~${upperMin} min` : `~${lowerMin}-${upperMin} min`
}

export function computeRunningEtaText(
  status: RunningStatusLike | null | undefined,
  timeoutFallbackSec: number,
  t: (key: 'status.etaUnavailable') => string,
): string | null {
  if (!status || status.status !== 'running') return null

  const total = status.progress?.total
  const current = status.progress?.current
  if (typeof total !== 'number' || typeof current !== 'number' || !Number.isFinite(total) || !Number.isFinite(current) || total <= 0) {
    return t('status.etaUnavailable')
  }
  const safeTotal = total
  const safeCurrent = current

  const remainingOps = Math.max(0, safeTotal - safeCurrent)
  const safeTimeout = Number.isFinite(status.timeout_sec) && (status.timeout_sec ?? 0) > 0 ? Number(status.timeout_sec) : timeoutFallbackSec
  if (!Number.isFinite(safeTimeout) || safeTimeout <= 0) {
    return t('status.etaUnavailable')
  }

  const perOpLower = Math.min(0.15, safeTimeout * 0.03)
  const perOpUpper = Math.min(0.8, safeTimeout * 0.2)
  const lowerBoundSec = Math.max(5, remainingOps * perOpLower)
  const upperBoundSec = Math.max(5, remainingOps * perOpUpper)
  return formatEtaRange(lowerBoundSec, upperBoundSec)
}
