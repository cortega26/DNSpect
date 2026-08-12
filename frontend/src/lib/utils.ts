import type { TranslationKey } from './i18n-translations'
import type { RunHistoryEntry } from './api'
import type { TargetScope } from './targetScope'
import type { Goal, Provider, ResolverResult } from './types'

const envApiBase = import.meta.env.VITE_API_BASE
export const API_BASE = typeof envApiBase === 'string' ? envApiBase : ''

/**
 * Rate metrics whose watch alert values are emitted by the backend as
 * absolute 0-1 point values (mirrors `watch.py`'s relative/rate metric
 * classification and `models.py`'s DEFAULT_WATCH_THRESHOLDS). The
 * cross-language contract — backend point deltas, frontend ×100 display —
 * is documented here; the canonical source lives in the backend.
 */
export const WATCH_RATE_METRICS: ReadonlySet<string> = new Set(['success_rate', 'failure_rate'])

export function fmtMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'NA'
  return `${value.toFixed(2)} ms`
}

export function providersByGoal(providers: Provider[], goal: Goal): Provider[] {
  if (goal === 'speed') return providers
  return providers.filter((p) => p.goals.includes(goal) || p.id === 'isp-detectado')
}

const REGION_LABEL_KEYS: Record<string, TranslationKey> = {
  global: 'region.global',
  europe: 'region.europe',
  'south-america': 'region.southAmerica',
  'north-america': 'region.northAmerica',
  asia: 'region.asia',
}

/** Translation key for the plan-004 normalized target scope label. */
export function regionLabelKey(scope: TargetScope | null): TranslationKey {
  if (scope === 'all') return 'region.all'
  if (scope && scope !== 'unknown' && scope in REGION_LABEL_KEYS) return REGION_LABEL_KEYS[scope]
  return 'region.auto'
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

export function isWatchRun(entry: { origin?: string | null } | null | undefined): boolean {
  return entry?.origin === 'watch'
}

export function latestUserRun(history: RunHistoryEntry[]): RunHistoryEntry | null {
  const candidates = history.filter((entry) => !isWatchRun(entry) && entry.status === 'done')
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null
}
