import { useI18n } from '@/lib/i18n'
import type { ResolverResult } from '@/lib/types'
import { fmtMs } from '@/lib/utils'

interface Props {
  result: ResolverResult
  rank: number
  reliabilityPct: number | null
  improvementVsCurrentMs: number | null
  copyStatus: 'idle' | 'success' | 'error'
  onApplyRecommended: () => void
  onCopyAddress: () => void
  onViewFullRanking?: () => void
}

export function RecommendedResolverPanel({
  result,
  rank,
  reliabilityPct,
  improvementVsCurrentMs,
  copyStatus,
  onApplyRecommended,
  onCopyAddress,
  onViewFullRanking,
}: Props) {
  const { t } = useI18n()

  return (
    <section className="card compact recommendation-card" aria-live="polite">
      <h3>{t('recommendation.cardLabel')}</h3>

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
          <h4>Score</h4>
          <p>{result.stats.score_total === null ? t('summary.na') : result.stats.score_total.toFixed(3)}</p>
        </article>
        <article className="metric-card">
          <h4>{t('recommendation.rank')}</h4>
          <p>#{rank}</p>
        </article>
      </div>

      <p className="recommendation-improvement">
        {improvementVsCurrentMs !== null
          ? t('recommendation.improvement', { ms: improvementVsCurrentMs.toFixed(0) })
          : t('recommendation.improvementUnavailable')}
      </p>

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

      {copyStatus === 'success' ? <p className="helper-text">{t('nextActions.copySuccess')}</p> : null}
      {copyStatus === 'error' ? <p className="helper-text">{t('nextActions.copyError')}</p> : null}
    </section>
  )
}
