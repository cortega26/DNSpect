import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useI18n } from '@/lib/i18n'
import type { Provider, ResolverResult } from '@/lib/types'
import { fmtMs } from '@/lib/utils'

interface Props {
  result: ResolverResult
  provider?: Provider
  canLoadSamples: boolean
  isLoadingSamples: boolean
  onLoadSamples: () => void
  onClose: () => void
}

function makeHistogram(samples: number[]): Array<{ bucket: string; count: number }> {
  if (!samples.length) return []
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const bins = 6
  const step = Math.max((max - min) / bins, 1)
  const hist = Array.from({ length: bins }, (_, i) => ({
    bucket: `${Math.round(min + i * step)}-${Math.round(min + (i + 1) * step)}`,
    count: 0,
  }))

  samples.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / step), bins - 1)
    hist[idx].count += 1
  })
  return hist
}

const FAILURE_KINDS = ['timeout', 'nxdomain', 'servfail', 'refused', 'noanswer', 'other'] as const

export function ResolverDetailModal({ result, provider, canLoadSamples, isLoadingSamples, onLoadSamples, onClose }: Props) {
  const { t } = useI18n()
  const lineData = result.samples.map((s) => ({ run: s.run_index, ms: s.ms ?? null }))
  const okSamples = result.samples.filter((s) => s.ok && s.ms !== null).map((s) => s.ms as number)
  const histogram = makeHistogram(okSamples)
  const failureBreakdown = FAILURE_KINDS.map((kind) => ({
    kind,
    count: result.samples.filter((sample) => sample.failure_kind === kind).length,
  }))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('modal.title', { resolver: result.resolver })}</h3>
          <button onClick={onClose}>{t('modal.close')}</button>
        </div>

        <p className="muted">
          {t('modal.provider')}: {provider?.name ?? result.provider_name}
        </p>
        <p className="muted">{provider?.notes_es ?? t('modal.noDescription')}</p>

        <div className="stats-grid">
          <div>
            <strong>{t('modal.median')}:</strong> {fmtMs(result.stats.median_ms)}
          </div>
          <div>
            <strong>{t('modal.p95')}:</strong> {fmtMs(result.stats.p95_ms)}
          </div>
          <div>
            <strong>{t('modal.average')}:</strong> {fmtMs(result.stats.avg_ms)}
          </div>
          <div>
            <strong>{t('modal.minMax')}:</strong> {fmtMs(result.stats.min_ms)} / {fmtMs(result.stats.max_ms)}
          </div>
          <div>
            <strong>{t('modal.ok')}:</strong> {result.stats.ok_count}
          </div>
          <div>
            <strong>{t('modal.timeouts')}:</strong> {result.stats.timeout_count}
          </div>
        </div>

        {result.samples.length === 0 ? (
          <section className="samples-callout">
            <p>{t('modal.samplesSummary')}</p>
            {canLoadSamples && (
              <button className="btn-primary" disabled={isLoadingSamples} onClick={onLoadSamples}>
                {isLoadingSamples ? t('modal.loadingSamples') : t('modal.loadSamples')}
              </button>
            )}
          </section>
        ) : (
          <>
            <section className="failure-grid">
              {failureBreakdown.map((item) => (
                <div key={item.kind} className="failure-item">
                  <strong>{item.kind}</strong>
                  <span>{item.count}</span>
                </div>
              ))}
            </section>

            <div className="detail-charts">
              <div>
                <h4>{t('modal.timeSeries')}</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={lineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="run" stroke="var(--muted)" />
                    <YAxis unit=" ms" stroke="var(--muted)" />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="ms"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div>
                <h4>{t('modal.histogram')}</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={histogram}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="bucket" stroke="var(--muted)" />
                    <YAxis allowDecimals={false} stroke="var(--muted)" />
                    <Tooltip />
                    <Bar dataKey="count" fill="var(--primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
