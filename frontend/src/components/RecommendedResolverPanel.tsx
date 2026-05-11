import { useI18n } from '@/lib/useI18n'
import type { ResolverResult } from '@/lib/types'
import { fmtMs, resolverBlockingScore } from '@/lib/utils'

interface Props {
  result: ResolverResult
  rank: number
  reliabilityPct: number | null
  improvementVsCurrentMs: number | null
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

export function RecommendedResolverPanel({
  result,
  rank,
  reliabilityPct,
  improvementVsCurrentMs,
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

  return (
    <section className="card card-strong compact" aria-live="polite">
      <h3>{t('recommendation.cardLabel')}</h3>
      {recommendationWarning ? (
        <p className="recommendation-warning" role="alert">
          {t('recommendation.warning', { warning: recommendationWarning })}
        </p>
      ) : null}

      <div className="recommendation-winner">
        <p className="recommendation-provider recommendation-provider-strong">{result.provider_name}</p>
        <p className="recommendation-ip recommendation-ip-strong">{result.resolver}</p>
      </div>

      <div className="recommendation-grid">
        <article className="metric-card">
          <h4>{t('recommendation.latency')}</h4>
          <p>{fmtMs(result.stats.score_latency ?? null)}</p>
        </article>
        <article className="metric-card">
          <h4>{t('recommendation.reliability')}</h4>
          <p>{reliabilityPct === null ? t('summary.na') : `${reliabilityPct.toFixed(1)}%`}</p>
        </article>
        <article className="metric-card">
          <h4>{t('recommendation.score')}</h4>
          <p>{result.stats.score_total === null ? t('summary.na') : result.stats.score_total.toFixed(3)}</p>
        </article>
        <article className="metric-card">
          <h4>{t('recommendation.rank')}</h4>
          <p>#{rank}</p>
        </article>
        {result.stats.blocking_test_count > 0 ? (
          <article className="metric-card">
            <h4>{t('recommendation.blocking')}</h4>
            <p>{(resolverBlockingScore(result) * 100).toFixed(0)}%</p>
          </article>
        ) : null}
      </div>

      <p className="recommendation-improvement">
        {improvementLabel}
      </p>
      {isSmallImprovement ? (
        <p className="helper-text recommendation-small-improvement">
          {t('recommendation.smallImprovement', { ms: Math.abs(improvementVsCurrentMs ?? 0).toFixed(1) })}
        </p>
      ) : null}

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
      <div className="actions-row">
        <button type="button" className="btn-secondary" onClick={onExportJson}>
          {t('nextActions.exportJson')}
        </button>
        <button type="button" className="btn-secondary" onClick={onExportCsv}>
          {t('nextActions.exportCsv')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCopySummary}>
          {t('nextActions.copySummary')}
        </button>
      </div>

      {copyStatus === 'success' ? <p className="helper-text" aria-live="polite">{t('nextActions.copySuccess')}</p> : null}
      {copyStatus === 'error' ? <p className="helper-text" aria-live="polite">{t('nextActions.copyError')}</p> : null}
      {summaryCopyStatus === 'success' ? <p className="helper-text" aria-live="polite">{t('nextActions.copySummarySuccess')}</p> : null}
      {summaryCopyStatus === 'error' ? <p className="helper-text" aria-live="polite">{t('nextActions.copySummaryError')}</p> : null}
    </section>
  )
}
