import { useI18n } from '@/lib/useI18n'
import type { ResolverResult } from '@/lib/types'
import { fmtMs } from '@/lib/utils'

interface Props {
  results: ResolverResult[]
  primary?: string
  secondary?: string
  emptyMessage?: string
  onSelect: (result: ResolverResult) => void
}

export function ResultsTable({ results, primary, secondary, emptyMessage, onSelect }: Props) {
  const { t } = useI18n()

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('results.title')}</h2>
        <p>{t('results.subtitle')}</p>
      </div>
      {results.length === 0 ? (
        <div className="empty-state">{emptyMessage ?? t('results.empty')}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('results.colDns')}</th>
                <th>{t('results.colProvider')}</th>
                <th>{t('results.colMedian')}</th>
                <th>{t('results.colP95')}</th>
                <th>{t('results.colAverage')}</th>
                <th>{t('results.colTimeouts')}</th>
                <th>{t('results.colOk')}</th>
                <th>{t('results.colDetail')}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => {
                const badge =
                  row.resolver === primary
                    ? t('results.recommendedPrimary')
                    : row.resolver === secondary
                      ? t('results.recommendedSecondary')
                      : ''
                return (
                  <tr key={row.resolver}>
                    <td>
                      <div className="dns-cell">
                        <span>{row.resolver}</span>
                        {badge && <small className="badge">{badge}</small>}
                      </div>
                    </td>
                    <td>{row.provider_name}</td>
                    <td>{fmtMs(row.stats.median_ms)}</td>
                    <td>{fmtMs(row.stats.p95_ms)}</td>
                    <td>{fmtMs(row.stats.avg_ms)}</td>
                    <td>{row.stats.timeout_count}</td>
                    <td>{row.stats.ok_count}</td>
                    <td>
                      <button type="button" className="table-link-btn" onClick={() => onSelect(row)}>
                        {t('results.viewDetail')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
