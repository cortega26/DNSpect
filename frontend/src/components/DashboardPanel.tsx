import { useI18n } from '@/lib/useI18n'
import type { ResolverResult } from '@/lib/types'
import { fmtMs } from '@/lib/utils'

interface Props {
  primaryResult: ResolverResult
  results: ResolverResult[]
  reliabilityPct: number | null
  improvementVsCurrentMs: number | null
  currentResolverLabel: string | null
  currentResolverRank: number | null
  recommendationWarning?: string | null
  isSmallImprovement?: boolean
  copyStatus: 'idle' | 'success' | 'error'
  summaryCopyStatus: 'idle' | 'success' | 'error'
  onApplyRecommended: () => void
  onCopyAddress: () => void
  onCopySummary: () => void
  onExportJson: () => void
  onExportCsv: () => void
  onViewFullRanking?: () => void
}

export function DashboardPanel({
  primaryResult,
  results,
  reliabilityPct,
  improvementVsCurrentMs,
  currentResolverLabel,
  currentResolverRank,
  recommendationWarning,
  isSmallImprovement,
  copyStatus,
  summaryCopyStatus,
  onApplyRecommended,
  onCopyAddress,
  onCopySummary,
  onExportJson,
  onExportCsv,
  onViewFullRanking,
}: Props) {
  const { t } = useI18n()
  const improvementLabel =
    improvementVsCurrentMs === null
      ? t('recommendation.improvementUnavailable')
      : improvementVsCurrentMs >= 0
        ? t('recommendation.improvement', { ms: improvementVsCurrentMs.toFixed(0) })
        : t('recommendation.improvementSlower', { ms: Math.abs(improvementVsCurrentMs).toFixed(0) })

  const top5 = results.slice(0, 5)

  return (
    <section className="dashboard-panel fade-in-section" aria-live="polite">
      {/* Hero Recommendation */}
      <div className="dashboard-hero">
        <div className="dashboard-hero-badge">{t('dashboard.recommended')}</div>
        <h2 className="dashboard-hero-title">{primaryResult.provider_name}</h2>
        <code className="dashboard-hero-ip">{primaryResult.resolver}</code>
        <div className="dashboard-hero-stats">
          <span className="dashboard-hero-stat">
            {t('recommendation.latency')}: <strong>{fmtMs(primaryResult.stats.score_latency ?? null)}</strong>
          </span>
          <span className="dashboard-hero-stat">
            {t('recommendation.reliability')}: <strong>{reliabilityPct === null ? t('summary.na') : `${reliabilityPct.toFixed(1)}%`}</strong>
          </span>
          <span className="dashboard-hero-stat">
            {t('recommendation.score')}: <strong>{primaryResult.stats.score_total === null ? t('summary.na') : primaryResult.stats.score_total.toFixed(3)}</strong>
          </span>
        </div>

        {recommendationWarning ? (
          <p className="recommendation-warning" role="alert">
            {t('recommendation.warning', { warning: recommendationWarning })}
          </p>
        ) : null}
      </div>

      {/* Improvement / Comparison */}
      <div className="dashboard-comparison">
        <p className="dashboard-improvement">{improvementLabel}</p>
        {isSmallImprovement ? (
          <p className="helper-text recommendation-small-improvement" style={{ marginTop: 0 }}>
            {t('recommendation.smallImprovement', { ms: Math.abs(improvementVsCurrentMs ?? 0).toFixed(1) })}
          </p>
        ) : null}
        {currentResolverLabel ? (
          <p className="dashboard-current-dns">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" aria-hidden="true">
              <rect x="2" y="2" width="20" height="8" rx="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" />
              <path d="M6 6h.01M6 18h.01" />
            </svg>
            {t('dashboard.currentDns', { label: currentResolverLabel })}
            {currentResolverRank !== null ? ` · ${t('dashboard.currentRank', { rank: currentResolverRank })}` : null}
          </p>
        ) : null}
      </div>

      {/* Top 5 Mini Ranking */}
      <div className="dashboard-top5">
        <h3>{t('dashboard.top5')}</h3>
        <ol className="dashboard-top5-list">
          {top5.map((r, i) => {
            const isPrimary = i === 0
            return (
              <li key={r.resolver} className={`dashboard-top5-item${isPrimary ? ' is-primary' : ''}`}>
                <span className="dashboard-top5-rank">{i + 1}</span>
                <span className="dashboard-top5-name">{r.provider_name}</span>
                <code className="dashboard-top5-ip">{r.resolver}</code>
                <span className="dashboard-top5-score">{fmtMs(r.stats.score_latency ?? null)}</span>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Action Bar */}
      <div className="dashboard-actions">
        <div className="actions-row">
          <button type="button" className="btn-primary" onClick={onApplyRecommended}>
            {t('nextActions.applyRecommendation')}
          </button>
          <button type="button" className="btn-secondary" onClick={onCopyAddress}>
            {t('nextActions.copyAddress')}
          </button>
          {onViewFullRanking ? (
            <button type="button" className="btn-ghost" onClick={onViewFullRanking}>
              {t('nextActions.viewFullRanking')}
            </button>
          ) : null}
        </div>
        <div className="actions-row" style={{ marginTop: 'var(--space-2)' }}>
          <button type="button" className="btn-ghost" onClick={onExportJson}>
            {t('nextActions.exportJson')}
          </button>
          <button type="button" className="btn-ghost" onClick={onExportCsv}>
            {t('nextActions.exportCsv')}
          </button>
          <button type="button" className="btn-ghost" onClick={onCopySummary}>
            {t('nextActions.copySummary')}
          </button>
        </div>
        {copyStatus === 'success' ? <p className="helper-text" aria-live="polite">{t('nextActions.copySuccess')}</p> : null}
        {copyStatus === 'error' ? <p className="helper-text" aria-live="polite">{t('nextActions.copyError')}</p> : null}
        {summaryCopyStatus === 'success' ? <p className="helper-text" aria-live="polite">{t('nextActions.copySummarySuccess')}</p> : null}
        {summaryCopyStatus === 'error' ? <p className="helper-text" aria-live="polite">{t('nextActions.copySummaryError')}</p> : null}
      </div>
    </section>
  )
}
