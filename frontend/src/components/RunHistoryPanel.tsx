import { useI18n } from '@/lib/useI18n'
import type { RunHistoryEntry } from '@/lib/api'

interface Props {
  runs: RunHistoryEntry[]
  loading: boolean
  onSelectRun: (runId: string) => void
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

export function RunHistoryPanel({ runs, loading, onSelectRun }: Props) {
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
        {runs.map((run) => (
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
          </li>
        ))}
      </ol>
    </section>
  )
}
