import type { Language, TranslationKey } from './i18n'
import type { BenchmarkStatus, ResolverResult } from './types'
import { fmtMs, resolverReliabilityScore } from './utils'

export const LAST_RUN_STORAGE_KEY = 'dnspect:last_run:v1'
export const LAST_RUN_SCHEMA_VERSION = 1

const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  es: 'es-ES',
  en: 'en-US',
  pt: 'pt-BR',
}

export interface LastRunMetadata {
  timestamp: string
  platform: string | null
  app_version: string | null
}

export interface SavedLastRunV1 {
  payload: BenchmarkStatus
  metadata: LastRunMetadata
}

type SavedLastRunInvalidationReason = 'schema_version_mismatch' | 'malformed_payload'

export interface LoadSavedLastRunResult {
  saved: SavedLastRunV1 | null
  invalidationReason: SavedLastRunInvalidationReason | null
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface SavedLastRunEnvelopeV1 extends SavedLastRunV1 {
  schema_version: number
}

const BASE_CSV_COLUMNS = [
  'resolver',
  'provider_id',
  'provider_name',
  'engine',
  'avg_ms',
  'median_ms',
  'p95_ms',
  'min_ms',
  'max_ms',
  'ok_count',
  'timeout_count',
  'success_rate',
  'timeout_rate',
  'success_count',
  'failure_count',
  'failure_rate',
  'consistency_ratio',
  'p95_minus_median_ms',
  'score_latency',
  'score_reliability',
  'score_stability',
  'score_total',
  'normalized_latency',
  'normalized_reliability',
  'normalized_stability',
  'reliability_penalty',
  'max_rel_penalty',
  'is_unreliable',
] as const

function getLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function quoteCsv(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'string' ? value : String(value)
  return `"${raw.replace(/"/g, '""')}"`
}

function stableSorted(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

function collectExtraColumns(results: ResolverResult[]): string[] {
  const itemExtras = new Set<string>()
  const statsExtras = new Set<string>()

  const known = new Set<string>(BASE_CSV_COLUMNS)
  results.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (key === 'stats' || key === 'samples' || key === 'sample_count') return
      if (!known.has(key)) itemExtras.add(key)
    })
    Object.keys(row.stats ?? {}).forEach((key) => {
      if (!known.has(key)) statsExtras.add(key)
    })
  })

  return [...stableSorted(statsExtras), ...stableSorted(itemExtras)]
}

function valueForColumn(row: ResolverResult, column: string): unknown {
  if (column in row.stats) return row.stats[column as keyof typeof row.stats]
  return row[column as keyof ResolverResult]
}

export function serializeSavedLastRun(saved: SavedLastRunV1): string {
  const envelope: SavedLastRunEnvelopeV1 = {
    schema_version: LAST_RUN_SCHEMA_VERSION,
    ...saved,
  }
  return JSON.stringify(envelope)
}

function migrateSavedLastRunEnvelope(_parsed: Record<string, unknown>): SavedLastRunV1 | null {
  // Placeholder for future migrations. Intentionally returns null in schema v1.
  return null
}

function deserializeSavedLastRunWithReason(raw: string): LoadSavedLastRunResult {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return { saved: null, invalidationReason: 'malformed_payload' }

    if (parsed.schema_version !== LAST_RUN_SCHEMA_VERSION) {
      const migrated = migrateSavedLastRunEnvelope(parsed)
      if (migrated) {
        return { saved: migrated, invalidationReason: null }
      }
      return { saved: null, invalidationReason: 'schema_version_mismatch' }
    }

    if (!isObject(parsed.payload) || !isObject(parsed.metadata)) {
      return { saved: null, invalidationReason: 'malformed_payload' }
    }

    const timestamp = parsed.metadata.timestamp
    if (typeof timestamp !== 'string' || !timestamp) {
      return { saved: null, invalidationReason: 'malformed_payload' }
    }

    return {
      saved: {
        payload: parsed.payload as unknown as BenchmarkStatus,
        metadata: {
          timestamp,
          platform: typeof parsed.metadata.platform === 'string' ? parsed.metadata.platform : null,
          app_version: typeof parsed.metadata.app_version === 'string' ? parsed.metadata.app_version : null,
        },
      },
      invalidationReason: null,
    }
  } catch {
    return { saved: null, invalidationReason: 'malformed_payload' }
  }
}

export function deserializeSavedLastRun(raw: string): SavedLastRunV1 | null {
  return deserializeSavedLastRunWithReason(raw).saved
}

export function loadSavedLastRun(storage: StorageLike | null = getLocalStorage()): LoadSavedLastRunResult {
  if (!storage) return { saved: null, invalidationReason: null }
  const raw = storage.getItem(LAST_RUN_STORAGE_KEY)
  if (!raw) return { saved: null, invalidationReason: null }

  const parsed = deserializeSavedLastRunWithReason(raw)
  if (!parsed.saved && parsed.invalidationReason) {
    storage.removeItem(LAST_RUN_STORAGE_KEY)
  }
  return parsed
}

export function persistSavedLastRun(
  payload: BenchmarkStatus,
  metadata: LastRunMetadata,
  storage: StorageLike | null = getLocalStorage(),
): SavedLastRunV1 | null {
  if (!storage) return null
  const saved: SavedLastRunV1 = { payload, metadata }
  storage.setItem(LAST_RUN_STORAGE_KEY, serializeSavedLastRun(saved))
  return saved
}

export function clearSavedLastRun(storage: StorageLike | null = getLocalStorage()): void {
  storage?.removeItem(LAST_RUN_STORAGE_KEY)
}

export function resolveRecommendedResult(status: BenchmarkStatus | null): ResolverResult | null {
  if (!status?.results || status.results.length === 0) return null
  if (status.recommended_resolver) {
    const found = status.results.find((row) => row.resolver === status.recommended_resolver)
    if (found) return found
  }
  return status.results[0] ?? null
}

export function buildResultsCsv(results: ResolverResult[]): string {
  const extraColumns = collectExtraColumns(results)
  const columns = [...BASE_CSV_COLUMNS, ...extraColumns]
  const lines = [
    columns.map((column) => quoteCsv(column)).join(','),
    ...results.map((row) => columns.map((column) => quoteCsv(valueForColumn(row, column))).join(',')),
  ]
  return lines.join('\n')
}

export function buildBenchmarkCsv(status: BenchmarkStatus | null): string {
  if (!status?.results?.length) return ''
  return buildResultsCsv(status.results)
}

function formatSummaryDate(value: string | null | undefined, language: Language): string {
  const source = value ? new Date(value) : new Date()
  if (Number.isNaN(source.getTime())) return new Date().toISOString().slice(0, 10)
  return new Intl.DateTimeFormat(LOCALE_BY_LANGUAGE[language], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(source)
}

interface SummaryParams {
  status: BenchmarkStatus
  language: Language
  t: (key: TranslationKey, params?: Record<string, number | string>) => string
  recommended: ResolverResult | null
  currentResolver: string
  improvementMs: number | null
}

export function buildShareSummary({
  status,
  language,
  t,
  recommended,
  currentResolver,
  improvementMs,
}: SummaryParams): string {
  const formattedDate = formatSummaryDate(status.finished_at ?? status.started_at, language)
  const recommendedLabel = recommended
    ? `${recommended.provider_name} (${recommended.resolver})`
    : t('summary.na')
  const reliabilityText =
    recommended === null ? t('summary.na') : `${(resolverReliabilityScore(recommended) * 100).toFixed(1)}%`

  let improvementText = t('share.improvementUnavailable')
  if (improvementMs !== null) {
    if (improvementMs > 0) improvementText = t('share.improvementFaster', { ms: improvementMs.toFixed(0) })
    else if (improvementMs < 0) improvementText = t('share.improvementSlower', { ms: Math.abs(improvementMs).toFixed(0) })
    else improvementText = t('share.improvementEqual')
  }

  const topLines = (status.results ?? []).slice(0, 5).map((row, index) => {
    const reliability = `${(resolverReliabilityScore(row) * 100).toFixed(1)}%`
    const latency = fmtMs(row.stats.score_latency ?? row.stats.avg_ms)
    return `${index + 1}. ${row.provider_name} (${row.resolver}) - ${latency} - ${reliability}`
  })

  const lines = [
    t('share.header', { date: formattedDate }),
    `${t('share.recommended')}: ${recommendedLabel}`,
    `${t('share.current')}: ${currentResolver || t('summary.na')}`,
    `${t('share.improvement')}: ${improvementText}`,
    `${t('share.reliability')}: ${reliabilityText}`,
  ]

  if (status.recommendation_warning) {
    lines.push(`${t('share.warning')}: ${status.recommendation_warning}`)
  }

  lines.push(`${t('share.top5')}:`)
  return [...lines, ...topLines].join('\n')
}
