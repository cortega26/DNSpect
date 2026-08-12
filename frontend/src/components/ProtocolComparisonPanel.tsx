import { useI18n } from '@/lib/useI18n'
import type {
  BenchmarkProtocol,
  ProtocolComparisonStatus,
  ProtocolDeltaPair,
  ProtocolMetrics,
} from '@/lib/types'
import { fmtMs } from '@/lib/utils'

interface Props {
  comparison: ProtocolComparisonStatus | null
  loading: boolean
  error: string | null
}

const METRIC_KEYS: Array<{ key: keyof ProtocolMetrics; labelKey: 'comparison.metricMedian' | 'comparison.metricP95' | 'comparison.metricSuccessRate' | 'comparison.metricFailureRate' | 'comparison.metricBlocking' | 'comparison.metricScore' }> = [
  { key: 'median_ms', labelKey: 'comparison.metricMedian' },
  { key: 'p95_ms', labelKey: 'comparison.metricP95' },
  { key: 'success_rate', labelKey: 'comparison.metricSuccessRate' },
  { key: 'failure_rate', labelKey: 'comparison.metricFailureRate' },
  { key: 'blocking_efficacy', labelKey: 'comparison.metricBlocking' },
  { key: 'score_total', labelKey: 'comparison.metricScore' },
]

const PROTOCOL_LABEL_KEY: Record<BenchmarkProtocol, 'protocol.udp' | 'protocol.dot' | 'protocol.doh' | 'protocol.doq'> = {
  udp: 'protocol.udp',
  dot: 'protocol.dot',
  doh: 'protocol.doh',
  doq: 'protocol.doq',
}

function fmtPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'NA'
  return `${(value * 100).toFixed(1)}%`
}

function fmtScore(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'NA'
  return value.toFixed(3)
}

function formatMetric(key: keyof ProtocolMetrics, value: number | null): string {
  if (key === 'median_ms' || key === 'p95_ms') return fmtMs(value)
  if (key === 'score_total') return fmtScore(value)
  return fmtPct(value)
}

function deltaTone(key: keyof ProtocolMetrics, value: number | null): { label: string; color: string } {
  const lowerBetter = key === 'median_ms' || key === 'p95_ms' || key === 'failure_rate'
  if (value === null || value === 0) return { label: '', color: 'var(--muted)' }
  const improved = lowerBetter ? value < 0 : value > 0
  return improved ? { label: ' ✓', color: 'var(--success)' } : { label: ' ✗', color: 'var(--warning)' }
}

function formatDelta(key: keyof ProtocolMetrics, value: number | null): string {
  if (value === null) return 'NA'
  const sign = value >= 0 ? '+' : ''
  if (key === 'median_ms' || key === 'p95_ms') return `${sign}${value.toFixed(2)} ms`
  if (key === 'score_total') return `${sign}${value.toFixed(3)}`
  return `${sign}${(value * 100).toFixed(1)}%`
}

function DeltaPairTable({ pair }: { pair: ProtocolDeltaPair }) {
  const { t } = useI18n()

  return (
    <details className="card compact card-subtle" style={{ marginBottom: 'var(--space-2)' }}>
      <summary style={{ cursor: 'pointer' }}>
        <strong>
          {t(PROTOCOL_LABEL_KEY[pair.baseline_protocol])} → {t(PROTOCOL_LABEL_KEY[pair.candidate_protocol])}
        </strong>
      </summary>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th scope="col">{t('results.colDns')}</th>
              <th scope="col">{t('comparison.metric')}</th>
              <th scope="col">{t(PROTOCOL_LABEL_KEY[pair.baseline_protocol])}</th>
              <th scope="col">{t(PROTOCOL_LABEL_KEY[pair.candidate_protocol])}</th>
              <th scope="col">{t('comparison.colDelta')}</th>
            </tr>
          </thead>
          <tbody>
            {pair.rows.flatMap((row) => {
              if (row.baseline === null || row.candidate === null) {
                return [
                  <tr key={row.resolver}>
                    <th scope="row" style={{ padding: 'var(--space-1) 0' }}>{row.resolver}</th>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{t('protocolComparison.missingRow')}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{t('protocolComparison.deltaUnavailable')}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{t('protocolComparison.deltaUnavailable')}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{t('protocolComparison.missingRow')}</td>
                  </tr>,
                ]
              }
              return METRIC_KEYS.map(({ key, labelKey }) => {
                const baseline = row.baseline![key]
                const candidate = row.candidate![key]
                const delta = row.deltas[key] as number | null
                const tone = deltaTone(key, delta)
                return (
                  <tr key={`${row.resolver}-${key as string}`}>
                    <th scope="row" style={{ padding: 'var(--space-1) 0' }}>
                      {key === 'median_ms' ? row.resolver : ''}
                    </th>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{t(labelKey)}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{formatMetric(key, baseline)}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)' }}>{formatMetric(key, candidate)}</td>
                    <td style={{ padding: 'var(--space-1) var(--space-2)', color: tone.color }}>
                      {formatDelta(key, delta)}
                      {tone.label}
                    </td>
                  </tr>
                )
              })
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export function ProtocolComparisonPanel({ comparison, loading, error }: Props) {
  const { t } = useI18n()

  if (loading && !comparison) {
    return (
      <section className="card compact fade-in-section protocol-comparison-panel">
        <h3>{t('protocolComparison.title')}</h3>
        <p className="muted">{t('comparison.loading')}</p>
      </section>
    )
  }

  if (error && !comparison) {
    return (
      <section className="card compact fade-in-section protocol-comparison-panel">
        <h3>{t('protocolComparison.title')}</h3>
        <p className="muted" role="alert">
          <strong>{t('comparison.errorTitle')}</strong> {error}
        </p>
      </section>
    )
  }

  if (!comparison) return null

  const running = comparison.status === 'queued' || comparison.status === 'running'
  const statusLabel = running
    ? comparison.progress.current_protocol
      ? t('protocolComparison.running', { protocol: t(PROTOCOL_LABEL_KEY[comparison.progress.current_protocol]) })
      : t('status.friendlyRunning')
    : comparison.status === 'failed'
      ? t('protocolComparison.statusFailed')
      : comparison.complete
        ? t('protocolComparison.statusDone')
        : t('protocolComparison.statusPartial')

  const progressPct = comparison.progress.total
    ? Math.min(100, Math.round((comparison.progress.current / comparison.progress.total) * 100))
    : 0

  return (
    <section className="card compact fade-in-section protocol-comparison-panel">
      <h3 className="section-heading-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
          <path d="M4 12h16M4 6h16M4 18h10" />
        </svg>
        {t('protocolComparison.title')}
        <span className={`badge ${comparison.status === 'failed' ? 'badge-danger' : comparison.complete ? 'badge-rec-primary' : 'badge-rank-3'}`}>
          {statusLabel}
        </span>
      </h3>

      {comparison.error ? (
        <p className="muted" role="alert">
          {t('status.errorHint', { error: comparison.error })}
        </p>
      ) : null}
      {comparison.run_storage_warning ? <p className="muted">{comparison.run_storage_warning}</p> : null}

      {running && (
        <div className="progress-wrap">
          <div className="progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
      )}
      <p className="muted">
        {t('protocolComparison.progress', {
          current: comparison.progress.current,
          total: comparison.progress.total,
        })}
      </p>

      {comparison.manifest.endpoint_identities.length > 0 ? (
        <>
          <h4>{t('protocolComparison.endpointTitle')}</h4>
          <ul>
            {comparison.manifest.endpoint_identities.map((identity) => (
              <li key={identity.resolver}>
                <code>{identity.udp_resolver_ip}</code>
                {identity.dot_hostname ? ` · DoT: ${identity.dot_hostname}` : ''}
                {identity.doh_url ? ` · DoH: ${identity.doh_url}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {comparison.subruns.length > 0 ? (
        <>
          <h4>{t('protocolComparison.rawTitle')}</h4>
          <ul>
            {comparison.subruns.map((subrun) => (
              <li key={subrun.protocol}>
                <strong>{t(PROTOCOL_LABEL_KEY[subrun.protocol])}</strong> ·{' '}
                {subrun.status === 'done'
                  ? t('protocolComparison.subrunDone', { protocol: t(PROTOCOL_LABEL_KEY[subrun.protocol]) })
                  : t('protocolComparison.subrunFailed', { protocol: t(PROTOCOL_LABEL_KEY[subrun.protocol]) })}
                {subrun.error ? ` · ${subrun.error.message}` : ''}
                {subrun.status === 'done'
                  ? ` · ${subrun.results.length} ${t('comparison.manifestTargets')}`
                  : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {comparison.delta_pairs.length > 0 ? (
        <>
          <h4>{t('protocolComparison.deltasTitle')}</h4>
          {comparison.delta_pairs.map((pair) => (
            <DeltaPairTable key={`${pair.baseline_protocol}-${pair.candidate_protocol}`} pair={pair} />
          ))}
        </>
      ) : null}

      {comparison.exclusions.length > 0 ? (
        <>
          <h4>{t('protocolComparison.exclusionsTitle')}</h4>
          <ul>
            {comparison.exclusions.map((exclusion) => (
              <li key={`${exclusion.resolver}-${exclusion.protocol}`}>
                {exclusion.resolver} · {t(PROTOCOL_LABEL_KEY[exclusion.protocol])} · {exclusion.code}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
