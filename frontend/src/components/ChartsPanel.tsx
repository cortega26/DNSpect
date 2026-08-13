import { useMemo, useState } from 'react'

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'

import { useI18n } from '@/lib/useI18n'
import type { ResolverResult } from '@/lib/types'
import { colorForValue, getMetricSpec, type ChartMetricKind } from '@/lib/chartPresentation'

type ChartView = ChartMetricKind

interface Props {
  results: ResolverResult[]
}

const CHART_LABEL_KEY: Record<ChartView, 'charts.medianView' | 'charts.p95View' | 'charts.reliabilityView' | 'charts.blockingView'> = {
  median: 'charts.medianView',
  p95: 'charts.p95View',
  reliability: 'charts.reliabilityView',
  blocking: 'charts.blockingView',
}

const CHART_VIEWS: Array<{ key: ChartView }> = [
  { key: 'median' },
  { key: 'p95' },
  { key: 'reliability' },
  { key: 'blocking' },
]

interface BarEntry {
  dns: string
  provider: string
  value: number | null
  rawValue: number | null
  failureRate: number
  unit: string
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  const { t } = useI18n()
  if (!active || !payload?.length) return null
  const entry = payload[0]?.payload as BarEntry | undefined
  if (!entry) return null

  return (
    <div
      style={{
        background: 'var(--panel-raised)',
        border: '1px solid var(--hairline)',
        borderRadius: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--ink)',
        padding: '8px 12px',
        display: 'grid',
        gap: 4,
      }}
    >
      <strong>{entry.provider}</strong>
      <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{label}</span>
      <span>
        <strong>{payload[0]?.value?.toFixed(1) ?? 'N/A'}</strong>
        {entry.unit}
      </span>
      {entry.failureRate > 0 && (
        <span style={{ color: 'var(--bad)', fontSize: 11 }}>
          {t('charts.failureRate', { value: (entry.failureRate * 100).toFixed(1) })}
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

  const metricSpec = useMemo(() => getMetricSpec(chartView), [chartView])

  const bars = useMemo(() => {
    return limitedResults.map((result) => {
      let value: number | null
      if (chartView === 'median') value = result.stats.median_ms
      else if (chartView === 'p95') value = result.stats.p95_ms
      else value = metricSpec.extractValue(result.stats.success_rate, result.stats.blocking_efficacy)

      return {
        dns: result.resolver,
        provider: result.provider_name,
        value,
        rawValue: value,
        failureRate: result.stats.failure_rate,
        unit: metricSpec.yAxisUnit,
      } as BarEntry
    })
      .filter((b) => b.value !== null)
      .sort((a, b) => {
        const dir = metricSpec.sortDirection === 'desc' ? -1 : 1
        return ((a.value ?? 0) - (b.value ?? 0)) * dir
      })
  }, [limitedResults, chartView, metricSpec])

  const sortedValues = useMemo(() => bars.map((b) => b.value as number).filter((v) => v !== null), [bars])

  const chartLabel = chartView === 'median'
    ? t('charts.medianByResolver')
    : chartView === 'p95'
      ? t('charts.p95ByResolver')
      : chartView === 'reliability'
        ? t('charts.reliabilityByResolver')
        : t('charts.blockingView')

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
                <CartesianGrid stroke="var(--hairline)" />
                <XAxis
                  dataKey="dns"
                  angle={-35}
                  textAnchor="end"
                  height={70}
                  interval={0}
                  stroke="var(--hairline)"
                  tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--ink-muted)' }}
                />
                <YAxis
                  unit={metricSpec.yAxisUnit}
                  stroke="var(--hairline)"
                  domain={metricSpec.yAxisDomain as [number | 'auto', number | 'auto']}
                  tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--ink-muted)' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {bars.map((entry, index) => (
                    <Cell key={index} fill={colorForValue(entry.value, sortedValues, metricSpec.favorableDirection)} />
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
