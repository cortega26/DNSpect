import { useI18n } from '@/lib/useI18n'
import type { RunHistoryEntry } from '@/lib/api'

interface Props {
  runs: RunHistoryEntry[]
  loading: boolean
  onSelectRun: (runId: string) => void
  baselineId: string | null
  candidateId: string | null
  onSetBaseline: (runId: string | null) => void
  onSetCandidate: (runId: string | null) => void
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function goalBadgeClass(goal: string): string {
  const map: Record<string, string> = {
    speed: 'badge-rank-1',
    security: 'badge-rank-2',
    privacy: 'badge-rank-3',
    'ad-blocking': 'badge-rec-primary',
    family: 'badge-rec-secondary',
  }
  return map[goal] ?? ''
}

function goalLabelText(goal: string, t: (key: string) => string): string {
  const keyMap: Record<string, string> = {
    speed: 'goal.speed',
    security: 'goal.security',
    privacy: 'goal.privacy',
    'ad-blocking': 'goal.adBlocking',
    family: 'goal.family',
  }
  const k = keyMap[goal]
  return k ? t(k) : goal
}

export function RunHistoryPanel({ runs, loading, onSelectRun, baselineId, candidateId, onSetBaseline, onSetCandidate }: Props) {
  const { t } = useI18n()

  if (loading) {
    return (
      <section className="card compact history-panel">
        <h3>{t('history.title')}</h3>
        <p className="muted">{t('history.loading')}</p>
      </section>
    )
  }

  if (runs.length === 0) {
    return (
      <section className="card compact history-panel">
        <h3>{t('history.title')}</h3>
        <p className="muted">{t('history.empty')}</p>
      </section>
    )
  }

  return (
    <section className="card compact history-panel">
      <h3>{t('history.title')}</h3>
      <p className="muted">{t('history.count', { count: runs.length })}</p>
      <ol className="history-list">
        {runs.map((run) => {
          const isBaseline = run.id === baselineId
          const isCandidate = run.id === candidateId
          return (
            <li key={run.id} className="history-item">
              <button type="button" className="history-btn" onClick={() => onSelectRun(run.id)}>
                <div className="history-item-header">
                  <span className={`badge ${goalBadgeClass((run.scoring_profile || run.goal) ?? '')}`}>
                    {goalLabelText((run.scoring_profile || run.goal) ?? '', t as (key: string) => string)}
                  </span>
                  <span className="history-mode">{run.mode}</span>
                </div>
                <div className="history-item-body">
                  <span className="history-date">{formatDate(run.started_at)}</span>
                  {run.results_summary.length > 0 ? (
                    <span className="history-top muted">{run.results_summary[0].provider_name} · {run.results_summary[0].resolver}</span>
                  ) : null}
                </div>
              </button>
              <div className="history-comparison-actions" style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '2px var(--space-2)', borderColor: isBaseline ? 'var(--success)' : undefined }}
                  aria-pressed={isBaseline}
                  aria-label={
                    isBaseline
                      ? t('comparison.unsetBaseline', { resolver: run.results_summary[0]?.resolver ?? run.id })
                      : t('comparison.setBaseline', { resolver: run.results_summary[0]?.resolver ?? run.id })
                  }
                  title={
                    isBaseline
                      ? t('comparison.unsetBaseline', { resolver: run.results_summary[0]?.resolver ?? run.id })
                      : t('comparison.setBaseline', { resolver: run.results_summary[0]?.resolver ?? run.id })
                  }
                  onClick={() => onSetBaseline(isBaseline ? null : run.id)}
                >
                  {t('comparison.baseline')}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '2px var(--space-2)', borderColor: isCandidate ? 'var(--success)' : undefined }}
                  aria-pressed={isCandidate}
                  aria-label={
                    isCandidate
                      ? t('comparison.unsetCandidate', { resolver: run.results_summary[0]?.resolver ?? run.id })
                      : t('comparison.setCandidate', { resolver: run.results_summary[0]?.resolver ?? run.id })
                  }
                  title={
                    isCandidate
                      ? t('comparison.unsetCandidate', { resolver: run.results_summary[0]?.resolver ?? run.id })
                      : t('comparison.setCandidate', { resolver: run.results_summary[0]?.resolver ?? run.id })
                  }
                  onClick={() => onSetCandidate(isCandidate ? null : run.id)}
                >
                  {t('comparison.candidate')}
                </button>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
