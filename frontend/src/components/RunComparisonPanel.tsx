import type { ReactElement } from 'react'

import type { TranslationKey } from '@/lib/i18n-translations'
import { useI18n } from '@/lib/useI18n'
import type {
  ComparisonReasonCode,
  RunComparisonMetrics,
  RunComparisonResponse,
  RunManifest,
} from '@/lib/types'
import { fmtMs } from '@/lib/utils'

interface Props {
  baselineId: string
  candidateId: string
  comparison: RunComparisonResponse | null
  loading: boolean
  error: string | null
  onClear: () => void
}

const REASON_CODE_KEYS: Record<ComparisonReasonCode, TranslationKey> = {
  manifest_missing: 'comparison.reason.manifest_missing',
  manifest_invalid: 'comparison.reason.manifest_invalid',
  manifest_version_mismatch: 'comparison.reason.manifest_version_mismatch',
  response_semantics_mismatch: 'comparison.reason.response_semantics_mismatch',
  scoring_semantics_mismatch: 'comparison.reason.scoring_semantics_mismatch',
  scoring_profile_mismatch: 'comparison.reason.scoring_profile_mismatch',
  target_snapshot_mismatch: 'comparison.reason.target_snapshot_mismatch',
  protocol_mismatch: 'comparison.reason.protocol_mismatch',
  query_plan_mismatch: 'comparison.reason.query_plan_mismatch',
  mode_mismatch: 'comparison.reason.mode_mismatch',
  runs_mismatch: 'comparison.reason.runs_mismatch',
  timeout_mismatch: 'comparison.reason.timeout_mismatch',
  diagnostic_policy_mismatch: 'comparison.reason.diagnostic_policy_mismatch',
  provider_catalog_mismatch: 'comparison.reason.provider_catalog_mismatch',
}

function fmtPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'NA'
  return `${(value * 100).toFixed(1)}%`
}

function fmtScore(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'NA'
  return value.toFixed(3)
}

function formatMetric(key: string, value: number | null): string {
  if (key === 'median_ms' || key === 'p95_ms') return fmtMs(value)
  if (key === 'score_total') return fmtScore(value)
  return fmtPct(value)
}

interface DeltaTone {
  label: string
  color: string
}

function deltaTone(key: string, value: number | null): DeltaTone {
  const isLowerBetter = key === 'median_ms' || key === 'p95_ms' || key === 'failure_rate'
  if (value === null || value === 0) {
    return { label: '', color: 'var(--muted)' }
  }
  const improved = isLowerBetter ? value < 0 : value > 0
  return improved
    ? { label: ' ✓', color: 'var(--success)' }
    : { label: ' ✗', color: 'var(--warning)' }
}

const METRIC_KEYS: Array<{ key: string; labelKey: TranslationKey }> = [
  { key: 'median_ms', labelKey: 'comparison.metricMedian' },
  { key: 'p95_ms', labelKey: 'comparison.metricP95' },
  { key: 'success_rate', labelKey: 'comparison.metricSuccessRate' },
  { key: 'failure_rate', labelKey: 'comparison.metricFailureRate' },
  { key: 'blocking_efficacy', labelKey: 'comparison.metricBlocking' },
  { key: 'score_total', labelKey: 'comparison.metricScore' },
]

function ManifestCard({ runId, manifest, titleKey }: { runId: string; manifest: RunManifest | null; titleKey: TranslationKey }) {
  const { t } = useI18n()

  if (!manifest) {
    return (
      <div className="card compact card-subtle" style={{ flex: 1, minWidth: 0 }}>
        <h4>{t(titleKey)}</h4>
        <p className="muted">{t('comparison.manifestUnavailable')}</p>
        <p>
          <code>{runId}</code>
        </p>
      </div>
    )
  }

  const targetCount = manifest.target_snapshot?.resolver_ips.length ?? 0
  const rows: Array<[string, string]> = [
    [t('comparison.manifestVersion'), String(manifest.run_manifest_version)],
    [t('comparison.manifestResponseSemantics'), manifest.response_semantics_version],
    [t('comparison.manifestScoringSemantics'), manifest.scoring_semantics_version],
    [t('comparison.manifestProfile'), manifest.scoring_profile],
    [t('comparison.manifestProtocol'), manifest.protocol],
    [t('comparison.manifestMode'), manifest.mode],
    [t('comparison.manifestRuns'), String(manifest.runs)],
    [t('comparison.manifestTimeout'), String(manifest.timeout_sec)],
    [t('comparison.manifestTargets'), String(targetCount)],
    [t('comparison.manifestSchedule'), manifest.normal_query_schedule_version],
    [t('comparison.manifestBlocking'), String(manifest.blocking_query_count)],
  ]

  return (
    <div className="card compact card-subtle" style={{ flex: 1, minWidth: 0 }}>
      <h4>{t(titleKey)}</h4>
      <dl style={{ margin: 0 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <dt className="muted" style={{ margin: 0 }}>{label}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function DeltaValue({ label, value, tone }: { label: string; value: string; tone: DeltaTone }) {
  return (
    <span aria-label={`${label} ${value}${tone.label.trim()}`}>
      {value}
      {tone.label}
    </span>
  )
}

function ComparableTable({ comparison }: { comparison: RunComparisonResponse }) {
  const { t } = useI18n()

  return (
    <>
      <h4>{t('comparison.rowsTitle')}</h4>
      {comparison.rows.map((row) => {
        const metricTones: Record<string, DeltaTone> = {}
        const metricValues: Record<string, [string, string]> = {}
        METRIC_KEYS.forEach(({ key }) => {
          const baselineValue = row.baseline[key as keyof RunComparisonMetrics]
          const candidateValue = row.candidate[key as keyof RunComparisonMetrics]
          const deltaValue = row.deltas[key as keyof RunComparisonMetrics] as number | null
          metricValues[key] = [formatMetric(key, baselineValue), formatMetric(key, candidateValue)]
          metricTones[key] = deltaTone(key, deltaValue)
        })
        const rankDelta = row.deltas.rank
        const rankTone = rankDelta === 0 ? { label: '', color: 'var(--muted)' } : rankDelta < 0 ? { label: ' ✓', color: 'var(--success)' } : { label: ' ✗', color: 'var(--warning)' }
        const signedRank = rankDelta > 0 ? `+${rankDelta}` : String(rankDelta)
        return (
          <details key={row.resolver} className="card compact card-subtle" style={{ marginBottom: 'var(--space-2)' }}>
            <summary style={{ cursor: 'pointer' }}>
              <strong>{row.resolver}</strong>
              <span className="muted" style={{ marginLeft: 'var(--space-2)' }}>
                {t('comparison.rank')}: {row.baseline_rank} → {row.candidate_rank}
              </span>
            </summary>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th scope="col">{t('comparison.metric')}</th>
                    <th scope="col">{t('comparison.colBaseline')}</th>
                    <th scope="col">{t('comparison.colCandidate')}</th>
                    <th scope="col">{t('comparison.colDelta')}</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_KEYS.map(({ key, labelKey }) => {
                    const [baselineText, candidateText] = metricValues[key]
                    const tone = metricTones[key]
                    const deltaValue = row.deltas[key as keyof RunComparisonMetrics] as number | null
                    const deltaText = deltaValue === null ? 'NA' : key === 'median_ms' || key === 'p95_ms'
                      ? `${deltaValue >= 0 ? '+' : ''}${deltaValue.toFixed(2)} ms`
                      : key === 'score_total'
                        ? `${deltaValue >= 0 ? '+' : ''}${deltaValue.toFixed(3)}`
                        : `${deltaValue >= 0 ? '+' : ''}${(deltaValue * 100).toFixed(1)}%`
                    return (
                      <tr key={key}>
                        <th scope="row" style={{ padding: 'var(--space-1) 0' }}>{t(labelKey)}</th>
                        <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{baselineText}</td>
                        <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{candidateText}</td>
                        <td style={{ padding: 'var(--space-1) var(--space-2)', color: tone.color }}>
                          <DeltaValue label={t(labelKey)} value={deltaText} tone={tone} />
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <th scope="row" style={{ padding: 'var(--space-1) 0' }}>{t('comparison.rank')}</th>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>#{row.baseline_rank}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>#{row.candidate_rank}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)', color: rankTone.color }}>
                      <DeltaValue label={t('comparison.rank')} value={signedRank} tone={rankTone} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        )
      })}
      {comparison.missing_baseline_results.length > 0 && (
        <p className="muted">
          {t('comparison.missingBaseline', { resolvers: comparison.missing_baseline_results.join(', ') })}
        </p>
      )}
      {comparison.missing_candidate_results.length > 0 && (
        <p className="muted">
          {t('comparison.missingCandidate', { resolvers: comparison.missing_candidate_results.join(', ') })}
        </p>
      )}
    </>
  )
}

export function RunComparisonPanel({ baselineId, candidateId, comparison, loading, error, onClear }: Props) {
  const { t } = useI18n()

  let content: ReactElement
  if (loading) {
    content = <p className="muted">{t('comparison.loading')}</p>
  } else if (error) {
    content = (
      <section className="error-box" role="alert">
        <p>
          <strong>{t('comparison.errorTitle')}</strong> {error}
        </p>
      </section>
    )
  } else if (!comparison) {
    content = <p className="muted">{t('comparison.selectHint')}</p>
  } else if (!comparison.comparable) {
    content = (
      <>
        <p className="muted">{t('comparison.notComparableExplanation')}</p>
        <p>
          <strong>{t('comparison.reasonCodes')}</strong>
        </p>
        <ol>
          {comparison.reason_codes.map((code) => (
            <li key={code}>{t(REASON_CODE_KEYS[code])}</li>
          ))}
        </ol>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
          <ManifestCard runId={comparison.baseline_id} manifest={comparison.baseline_manifest} titleKey="comparison.baselineManifest" />
          <ManifestCard runId={comparison.candidate_id} manifest={comparison.candidate_manifest} titleKey="comparison.candidateManifest" />
        </div>
      </>
    )
  } else {
    content = <ComparableTable comparison={comparison} />
  }

  return (
    <section className="card compact fade-in-section comparison-panel">
      <h3 className="section-heading-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
          <path d="M12 2v20M17 7l5-5M7 7L2 2M7 17l-5 5M17 17l5 5" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {t('comparison.title')}
        {comparison ? (
          <span className={`badge ${comparison.comparable ? 'badge-rec-primary' : 'badge-rank-3'}`}>
            {comparison.comparable ? t('comparison.comparableBadge') : t('comparison.notComparable')}
          </span>
        ) : null}
      </h3>
      <p className="muted">
        {t('comparison.baselineOf', { id: baselineId })}
        {' · '}
        {t('comparison.candidateOf', { id: candidateId })}
      </p>
      {content}
      <div className="actions-row">
        <button type="button" className="btn-ghost" onClick={onClear}>
          {t('comparison.clearSelection')}
        </button>
      </div>
    </section>
  )
}
