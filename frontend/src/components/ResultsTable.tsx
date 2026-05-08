import { useMemo } from 'react'

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

function latencyColorClass(medianMs: number | null, minMedian: number, maxMedian: number): string {
  if (medianMs === null) return ''
  const range = Math.max(maxMedian - minMedian, 1)
  const ratio = (medianMs - minMedian) / range
  if (ratio < 0.33) return '' // fast — no background
  if (ratio < 0.66) return '' // moderate — no background either
  return '' // keep clean, let the bars in charts show color
}

export function ResultsTable({ results, primary, secondary, emptyMessage, onSelect }: Props) {
  const { t } = useI18n()

  const medians = useMemo(() => results.map((r) => r.stats.median_ms).filter((v): v is number => v !== null), [results])
  const minMedian = medians.length > 0 ? Math.min(...medians) : 0
  const maxMedian = medians.length > 0 ? Math.max(...medians) : 0

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('results.title')}</h2>
        <p>{t('results.subtitle')}</p>
      </div>
      {results.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
          </svg>
          <span className="empty-state-title">{emptyMessage ?? t('results.empty')}</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('results.colRank')}</th>
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
              {results.map((row, index) => {
                const badge =
                  row.resolver === primary
                    ? t('results.recommendedPrimary')
                    : row.resolver === secondary
                      ? t('results.recommendedSecondary')
                      : ''
                const latencyClass = latencyColorClass(row.stats.median_ms, minMedian, maxMedian)
                return (
                  <tr key={row.resolver}>
                    <td>
                      <span className="badge" style={{ minWidth: '2rem', textAlign: 'center' }}>#{index + 1}</span>
                    </td>
                    <td>
                      <div className="dns-cell">
                        <span className="font-mono">{row.resolver}</span>
                        {badge && <small className="badge">{badge}</small>}
                      </div>
                    </td>
                    <td>{row.provider_name}</td>
                    <td className={latencyClass} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMs(row.stats.median_ms)}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMs(row.stats.p95_ms)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMs(row.stats.avg_ms)}</td>
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
