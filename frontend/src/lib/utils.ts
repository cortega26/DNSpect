import type { Provider, ResolverResult } from './types'

const envApiBase = import.meta.env.VITE_API_BASE
export const API_BASE = typeof envApiBase === 'string' ? envApiBase : ''

export function fmtMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'NA'
  return `${value.toFixed(2)} ms`
}

export function resolverGroup(provider?: Provider): string {
  if (!provider) return 'Global'
  const tags = provider.tags ?? []
  if (tags.includes('isp_detectado')) return 'ISP detectados'
  if (tags.includes('chile') || tags.includes('latam')) return 'LATAM/Chile'
  if (tags.includes('privacidad')) return 'Privacidad'
  return 'Global'
}

export function sortRanking(results: ResolverResult[], options?: { naLast?: boolean }): ResolverResult[] {
  const naLast = options?.naLast ?? true
  return [...results].sort((a, b) => {
    const naRank = naLast ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
    const am = a.stats.median_ms ?? naRank
    const bm = b.stats.median_ms ?? naRank
    if (am !== bm) return am - bm
    const ap = a.stats.p95_ms ?? naRank
    const bp = b.stats.p95_ms ?? naRank
    if (ap !== bp) return ap - bp
    return a.stats.timeout_count - b.stats.timeout_count
  })
}

export function recommendations(results: ResolverResult[]): { primary?: string; secondary?: string } {
  const candidates = results
    .filter((r) => r.stats.median_ms !== null)
    .sort((a, b) => {
      const aMedian = a.stats.median_ms ?? Number.POSITIVE_INFINITY
      const bMedian = b.stats.median_ms ?? Number.POSITIVE_INFINITY
      const aTimeout = a.stats.timeout_rate
      const bTimeout = b.stats.timeout_rate
      const aP95 = a.stats.p95_ms ?? Number.POSITIVE_INFINITY
      const bP95 = b.stats.p95_ms ?? Number.POSITIVE_INFINITY

      const scoreA = aMedian + aTimeout * 300 + (aP95 - aMedian) * 0.2
      const scoreB = bMedian + bTimeout * 300 + (bP95 - bMedian) * 0.2
      if (scoreA !== scoreB) return scoreA - scoreB
      if (aP95 !== bP95) return aP95 - bP95
      return a.resolver.localeCompare(b.resolver)
    })

  const reliable = candidates.filter((r) => r.stats.timeout_rate <= 0.2)
  const pick = reliable.length >= 2 ? reliable : candidates
  return {
    primary: pick[0]?.resolver,
    secondary: pick[1]?.resolver,
  }
}
