import { useMemo, useState } from 'react'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useI18n } from '@/lib/i18n'
import type { ResolverResult } from '@/lib/types'

interface Props {
  results: ResolverResult[]
}

export function ChartsPanel({ results }: Props) {
  const { t } = useI18n()
  const [topN, setTopN] = useState<number>(10)

  const limitedResults = useMemo(() => {
    if (topN <= 0) return results
    return results.slice(0, topN)
  }, [results, topN])

  const bars = limitedResults.map((result) => ({
    dns: result.resolver,
    median: result.stats.median_ms ?? null,
  }))

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('charts.title')}</h2>
        <p>{t('charts.subtitle')}</p>
        <div className="chart-controls">
          <label>
            {t('charts.show')}
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
              <option value={10}>{t('charts.top10')}</option>
              <option value={15}>{t('charts.top15')}</option>
              <option value={0}>{t('charts.all')}</option>
            </select>
            {t('charts.resolversByMedian')}
          </label>
        </div>
      </div>

      {limitedResults.length === 0 ? (
        <div className="empty-state">{t('charts.empty')}</div>
      ) : (
        <div className="chart-grid">
          <div className="chart-card">
            <h3>{t('charts.medianByResolver')}</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={bars} margin={{ top: 8, right: 16, left: 8, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="dns" angle={-35} textAnchor="end" height={70} interval={0} stroke="var(--muted)" />
                <YAxis unit=" ms" stroke="var(--muted)" />
                <Tooltip />
                <Bar dataKey="median" fill="var(--primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  )
}
