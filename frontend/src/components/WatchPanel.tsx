import { useState } from 'react'

import { useWatch } from '@/hooks/useWatch'
import { useI18n } from '@/lib/useI18n'
import type {
  BenchmarkMode,
  BenchmarkProtocol,
  ScoringProfile,
  TargetSnapshot,
  WatchConfigPayload,
  WatchEntry,
} from '@/lib/types'
import { fmtMs, WATCH_RATE_METRICS } from '@/lib/utils'

const DEFAULT_WATCH_THRESHOLDS: Record<string, number> = {
  median_ms: 25.0,
  failure_rate: 5.0,
  success_rate: 5.0,
}

export interface WatchSessionConfig {
  target_snapshot: TargetSnapshot
  protocol: BenchmarkProtocol
  scoring_profile: ScoringProfile
  mode: BenchmarkMode
  runs: number
  timeout_sec: number
  queries?: string[]
}

interface Props {
  doqAvailable: boolean
  running: boolean
  currentSession: WatchSessionConfig | null
  onCompare: (baselineId: string, candidateId: string) => void
}

function statusOf(entry: WatchEntry): 'idle' | 'running' | 'evaluating' {
  if (entry.runtime.active_run_id) return 'running'
  if (entry.runtime.last_run_id && !entry.runtime.last_evaluated_at) return 'evaluating'
  return 'idle'
}

function formatMetricValue(metric: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'NA'
  if (WATCH_RATE_METRICS.has(metric)) return `${(value * 100).toFixed(1)}%`
  if (metric === 'median_ms' || metric === 'p95_ms') return fmtMs(value)
  return value.toFixed(2)
}

function formatMetricDelta(metric: string, delta: number | null | undefined): string {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return 'NA'
  if (WATCH_RATE_METRICS.has(metric)) return `${(delta * 100).toFixed(1)}%`
  return `${delta.toFixed(1)}%`
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

export function WatchPanel({ doqAvailable, running, currentSession, onCompare }: Props) {
  const { t } = useI18n()
  const { watches, watchesLoading, watchesError, create, remove } = useWatch()
  const [intervalMin, setIntervalMin] = useState(30)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const noResolvers = currentSession === null || currentSession.target_snapshot.resolver_ips.length === 0
  const doqBlocked = currentSession?.protocol === 'doq' && !doqAvailable
  const canCreate = currentSession !== null && !noResolvers && !doqBlocked && !running

  async function handleCreate() {
    if (!currentSession) return
    const payload: WatchConfigPayload = {
      target_snapshot: currentSession.target_snapshot,
      protocol: currentSession.protocol,
      scoring_profile: currentSession.scoring_profile,
      mode: currentSession.mode,
      runs: currentSession.runs,
      timeout_sec: currentSession.timeout_sec,
      interval_min: Math.max(1, Math.round(Number.isFinite(intervalMin) ? intervalMin : 30)),
      ...(currentSession.queries && currentSession.queries.length > 0 ? { queries: currentSession.queries } : {}),
    }
    try {
      await create(payload)
      setCreateError(null)
    } catch {
      setCreateError(t('watch.error.create'))
    }
  }

  async function handleRemove(watchId: string) {
    if (!window.confirm(t('watch.deleteConfirm'))) return
    try {
      await remove(watchId)
      setDeleteError(null)
    } catch {
      setDeleteError(t('watch.error.delete'))
    }
  }

  const thresholdLabel = Object.entries(DEFAULT_WATCH_THRESHOLDS)
    .map(([key, value]) => `${key} ${WATCH_RATE_METRICS.has(key) ? `±${value} pts` : `±${value}%`}`)
    .join(' · ')

  return (
    <section className="card compact watch-panel fade-in-section">
      <h3 className="section-heading-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
        {t('watch.title')}
      </h3>
      <p className="muted">{t('watch.description')}</p>

      <div className="watch-create-form">
        <label className="watch-interval-label">
          {t('watch.interval')}
          <span className="watch-interval-input">
            <input
              type="number"
              min={1}
              value={intervalMin}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
              aria-label={t('watch.interval')}
            />
            <span className="muted">{t('watch.intervalMinutes')}</span>
          </span>
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={!canCreate}
          onClick={() => {
            void handleCreate()
          }}
        >
          {t('watch.create')}
        </button>
        {createError && (
          <p className="muted" role="alert">
            {createError}
          </p>
        )}
        <p className="muted watch-thresholds">{thresholdLabel}</p>
        <p className="muted">{t('watch.hiddenFromHistory')}</p>
      </div>

      {deleteError && (
        <p className="muted" role="alert">
          {deleteError}
        </p>
      )}

      {watchesLoading ? (
        <p className="muted">{t('history.loading')}</p>
      ) : watchesError ? (
        <p className="muted" role="alert">
          {t('watch.error.load')}
        </p>
      ) : watches.length === 0 ? (
        <p className="muted">{t('watch.empty')}</p>
      ) : (
        <ul className="watch-list">
          {watches.map((entry) => {
            const status = statusOf(entry)
            const statusKey =
              status === 'running' ? 'watch.status.running' : status === 'evaluating' ? 'watch.status.evaluating' : 'watch.status.idle'
            const alertCount = entry.runtime.alert_events.filter((event) => event.type === 'threshold_alert').length
            return (
              <li key={entry.watch_id} className="watch-item">
                <div className="watch-item-main">
                  <span className="history-mode">{entry.config.protocol ?? 'udp'}</span>
                  <span className={`badge watch-status watch-status--${status}`}>{t(statusKey)}</span>
                  <span className="muted">
                    {entry.config.mode} · {t('watch.intervalMinutes')}: {entry.config.interval_min}
                  </span>
                  {alertCount > 0 && (
                    <span className="badge watch-alert-count" role="status">
                      {t('watch.alerts')}: {alertCount}
                    </span>
                  )}
                  <span className="muted">
                    {entry.runtime.last_evaluated_at
                      ? `${t('watch.lastEvaluated')}: ${new Date(entry.runtime.last_evaluated_at).toLocaleString()}`
                      : t('watch.status.idle')}
                  </span>
                </div>
                <button type="button" className="btn-ghost" onClick={() => void handleRemove(entry.watch_id)}>
                  {t('watch.delete')}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {watches.some((entry) => entry.runtime.alert_events.length > 0) && (
        <div className="watch-alert-banner" role="status">
          <h4>{t('watch.alerts')}</h4>
          <ul className="watch-alert-list">
            {watches.flatMap((entry) =>
              [...entry.runtime.alert_events].reverse().map((event, index) => (
                <li key={`${entry.watch_id}-${index}`} className="watch-alert-item">
                  {event.type === 'threshold_alert' ? (
                    <>
                      <span>
                        {t('watch.alert.degraded', {
                          metric: event.metric ?? 'metric',
                          resolver: event.resolver ?? 'resolver',
                          baseline: formatMetricValue(event.metric ?? '', event.baseline_value),
                          candidate: formatMetricValue(event.metric ?? '', event.candidate_value),
                          delta: formatMetricDelta(event.metric ?? '', event.delta),
                        })}
                      </span>
                      {event.baseline_id && event.run_id && (
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => onCompare(event.baseline_id as string, event.run_id as string)}
                        >
                          {t('comparison.title')}
                        </button>
                      )}
                    </>
                  ) : event.type === 'no_comparable_baseline' ? (
                    <span className="muted">
                      {t('watch.alert.noBaseline', { run: shortId(event.run_id ?? '') })}
                      {event.reason_codes && event.reason_codes.length > 0 ? ` (${event.reason_codes.join(', ')})` : ''}
                    </span>
                  ) : (
                    <span className="muted">{event.type}</span>
                  )}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
    </section>
  )
}
