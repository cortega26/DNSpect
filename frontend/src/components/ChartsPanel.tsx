import { useMemo, useState } from 'react'

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'

import { useI18n } from '@/lib/useI18n'
import type { ResolverResult } from '@/lib/types'

type ChartView = 'median' | 'p95' | 'reliability'

interface Props {
  results: ResolverResult[]
}

const CHART_LABEL_KEY: Record<ChartView, 'charts.medianView' | 'charts.p95View' | 'charts.reliabilityView'> = {
  median: 'charts.medianView',
  p95: 'charts.p95View',
  reliability: 'charts.reliabilityView',
}

const CHART_VIEWS: Array<{ key: ChartView }> = [
  { key: 'median' },
  { key: 'p95' },
  { key: 'reliability' },
]

interface BarEntry {
  dns: string
  provider: string
  value: number | null
  rawValue: number | null
  failureRate: number
}

function performanceColor(value: number | null, sortedValues: number[]): string {
  if (value === null || sortedValues.length < 3) return 'var(--accent)'
  const thresholdLow = sortedValues[Math.floor(sortedValues.length / 3)]
  const thresholdHigh = sortedValues[Math.floor((sortedValues.length * 2) / 3)]
  if (value <= thresholdLow) return 'var(--success)'
  if (value <= thresholdHigh) return 'var(--warning)'
  return 'var(--danger)'
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]?.payload as BarEntry | undefined
  if (!entry) return null

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 12px',
        boxShadow: 'var(--shadow)',
        fontSize: '0.88rem',
        display: 'grid',
        gap: '4px',
      }}
    >
      <strong style={{ fontSize: '0.94rem' }}>{entry.provider}</strong>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--muted)' }}>{label}</span>
      <span>
        <strong>{payload[0]?.value?.toFixed(1) ?? 'N/A'}</strong>
        {payload[0]?.name === 'value' ? ' ms' : ''}
        {payload[0]?.name === 'reliability' ? '%' : ''}
      </span>
      {entry.failureRate > 0 && (
        <span style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>
          Failure rate: {(entry.failureRate * 100).toFixed(1)}%
        </span>
      )}
    </div>
  )
}

export function ChartsPanel({ results }: Props) {
  const { t } = useI18n()
  const [topN, setTopN] = useState<number>(10)
  const [chartView, setChartView] = useState<ChartView>('median')

  const limitedResults = useMemo(() => {
    if (topN <= 0) return results
    return results.slice(0, topN)
  }, [results, topN])

  const bars = useMemo(() => {
    return limitedResults.map((result) => {
      let value: number | null = null
      if (chartView === 'median') value = result.stats.median_ms
      else if (chartView === 'p95') value = result.stats.p95_ms
      else if (chartView === 'reliability')
        value = result.stats.success_rate !== null ? result.stats.success_rate * 100 : null

      return {
        dns: result.resolver,
        provider: result.provider_name,
        value,
        rawValue: value,
        failureRate: result.stats.failure_rate,
      } as BarEntry
    })
      .filter((b) => b.value !== null)
      .sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity))
  }, [limitedResults, chartView])

  const sortedValues = useMemo(() => bars.map((b) => b.value as number).filter((v) => v !== null), [bars])

  const chartLabel = chartView === 'median'
    ? t('charts.medianByResolver')
    : chartView === 'p95'
      ? t('charts.p95ByResolver')
      : t('charts.reliabilityByResolver')

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('charts.title')}</h2>
        <p>{t('charts.subtitle')}</p>
        <div className="chart-tabs">
          {CHART_VIEWS.map((view) => (
            <button
              key={view.key}
              type="button"
              className={`chart-tab${chartView === view.key ? ' chart-tab-active' : ''}`}
              onClick={() => setChartView(view.key)}
            >
              {t(CHART_LABEL_KEY[view.key])}
            </button>
          ))}
        </div>
        <div className="chart-controls">
          <label>
            {t('charts.show')}
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
              <option value={10}>{t('charts.top10')}</option>
              <option value={15}>{t('charts.top15')}</option>
              <option value={0}>{t('charts.all')}</option>
            </select>
          </label>
        </div>
      </div>

      {limitedResults.length === 0 ? (
        <div className="empty-state" style={{ gap: 'var(--space-3)' }}>
          <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="M7 14l3-5 4 4 4-7" />
            <circle cx="18" cy="8" r="2" fill="currentColor" stroke="none" opacity="0.3" />
          </svg>
          <span className="empty-state-title">{t('charts.empty')}</span>
          <span className="empty-state-body">{t('filters.empty')}</span>
        </div>
      ) : (
        <div className="chart-grid">
          <div className="chart-card">
            <h3>{chartLabel}</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={bars} margin={{ top: 8, right: 16, left: 8, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="dns" angle={-35} textAnchor="end" height={70} interval={0} stroke="var(--muted)" />
                <YAxis
                  unit={chartView !== 'reliability' ? ' ms' : '%'}
                  stroke="var(--muted)"
                  domain={chartView === 'reliability' ? [95, 100] : ['auto', 'auto']}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {bars.map((entry, index) => (
                    <Cell key={index} fill={performanceColor(entry.value, sortedValues)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  )
}
