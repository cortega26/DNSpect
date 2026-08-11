import { useI18n } from '@/lib/useI18n'
import type { ResolverResult } from '@/lib/types'
import { fmtMs, resolverBlockingScore, resolverReliabilityScore } from '@/lib/utils'
import { formatRankLabel } from '@/lib/chartPresentation'

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
        <div className="empty-state">
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span className="empty-state-title">{emptyMessage ?? t('results.empty')}</span>
        </div>
      ) : (
        <details className="ranking-collapse" open>
          <summary>{t('ranking.collapseLabel', { count: results.length })}</summary>
          <ol className="ranking-list">
            {results.map((row, index) => {
              const reliabilityPct = (resolverReliabilityScore(row) * 100).toFixed(1)
              const scoreTotal = row.stats.score_total === null ? 'NA' : row.stats.score_total.toFixed(3)
              const rankLabel = formatRankLabel(index + 1)
              return (
                <li key={row.resolver} className={`ranking-row${index < 3 ? ` ranking-row-rank-${index + 1}` : ''}`}>
                  <div className="ranking-main">
                  <p className="ranking-line">
                      <span className="ranking-rank">{rankLabel}</span> {row.provider_name} - {row.resolver}
                      <span className="badge badge-protocol">{row.protocol === 'dot' ? t('protocol.dot') : row.protocol === 'doh' ? t('protocol.doh') : t('protocol.udp')}</span>
                      {row.stats.nxdomain_hijack_detected === true ? (
                        <span className="badge badge-danger" title={t('results.nxdomainHijacked')}>{t('results.nxdomainBadge')}</span>
                      ) : row.stats.nxdomain_hijack_detected === false ? (
                        <span className="badge badge-success" title={t('results.nxdomainClean')}>{t('results.nxdomainCleanBadge')}</span>
                      ) : null}
                      {row.stats.dnssec_validating === true ? (
                        <span className="badge badge-success" title={t('results.dnssecValidating')}>{t('results.dnssecBadge')}</span>
                      ) : row.stats.dnssec_validating === false ? (
                        <span className="badge badge-danger" title={t('results.dnssecNotValidating')}>{t('results.dnssecNotBadge')}</span>
                      ) : null}
                    </p>
                    <p className="muted ranking-meta">
                      Score {scoreTotal} - {fmtMs(row.stats.score_latency)} - {reliabilityPct}%
                      {row.stats.blocking_test_count > 0 ? ` - Bloqueo ${(resolverBlockingScore(row) * 100).toFixed(0)}%` : ''}
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
