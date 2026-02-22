import { useI18n } from '@/lib/i18n'
import type { ResolverResult } from '@/lib/types'
import { fmtMs, resolverReliabilityScore } from '@/lib/utils'

interface Props {
  id?: string
  results: ResolverResult[]
  emptyMessage?: string
  onSelect?: (result: ResolverResult) => void
}

export function ResolverRankingPanel({ id, results, emptyMessage, onSelect }: Props) {
  const { t } = useI18n()

  return (
    <section id={id} className="card compact ranking-panel" aria-live="polite">
      <h3>{t('ranking.title')}</h3>

      {results.length === 0 ? (
        <div className="empty-state">{emptyMessage ?? t('results.empty')}</div>
      ) : (
        <details className="ranking-collapse" open>
          <summary>{t('ranking.collapseLabel', { count: results.length })}</summary>
          <ol className="ranking-list">
            {results.map((row, index) => {
              const reliabilityPct = (resolverReliabilityScore(row) * 100).toFixed(1)
              const scoreTotal = row.stats.score_total === null ? 'NA' : row.stats.score_total.toFixed(3)
              return (
                <li key={row.resolver} className="ranking-row">
                  <div className="ranking-main">
                    <p className="ranking-line">
                      <span className="ranking-rank">#{index + 1}</span> {row.provider_name} - {row.resolver}
                    </p>
                    <p className="muted ranking-meta">
                      Score {scoreTotal} - {fmtMs(row.stats.score_latency)} - {reliabilityPct}%
                    </p>
                  </div>
                  {onSelect ? (
                    <button type="button" className="table-link-btn" onClick={() => onSelect(row)}>
                      {t('results.viewDetail')}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </details>
      )}
    </section>
  )
}
