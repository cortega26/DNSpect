import type { Goal, Provider, ResolverResult } from './types'

const envApiBase = import.meta.env.VITE_API_BASE
export const API_BASE = typeof envApiBase === 'string' ? envApiBase : ''

export function fmtMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'NA'
  return `${value.toFixed(2)} ms`
}

export function providersByGoal(providers: Provider[], goal: Goal): Provider[] {
  if (goal === 'speed') return providers
  return providers.filter((p) => p.goals.includes(goal) || p.id === 'isp-detectado')
}

export function regionLabel(region: string | null): string {
  if (!region) return 'Auto'
  const labels: Record<string, string> = {
    global: 'Global',
    europe: 'Europe',
    'south-america': 'South America',
    'north-america': 'North America',
    asia: 'Asia',
    oceania: 'Oceania',
    africa: 'Africa',
    auto: 'Auto',
  }
  return labels[region] ?? region
}

export function resolverGroup(provider?: Provider): string {
  if (!provider) return 'Global'
  const tags = provider.tags ?? []
  if (tags.includes('isp_detectado')) return 'ISP detectados'
  if (tags.includes('privacidad')) return 'Privacidad'
  if (provider.region && provider.region !== 'global') {
    if (provider.country) return provider.country.toUpperCase()
    return provider.region
  }
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

export function resolverBlockingScore(result: ResolverResult): number {
  const val = result.stats.blocking_efficacy
  if (val !== null && Number.isFinite(val)) {
    return Math.max(0, Math.min(1, val))
  }
  return 0
}
