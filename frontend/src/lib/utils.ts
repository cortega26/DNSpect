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

export function resolverReliabilityScore(result: ResolverResult): number {
  const failureRate = result.stats.failure_rate
  if (Number.isFinite(failureRate)) {
    return Math.max(0, Math.min(1, 1 - failureRate))
  }
  const successRate = result.stats.success_rate
  if (Number.isFinite(successRate)) {
    return Math.max(0, Math.min(1, successRate))
  }
  return 0
}
