import { useMemo } from 'react'

import { resolveRecommendedResult } from '@/lib/reporting'
import type { BenchmarkStatus, ResolverResult, SystemDnsPayload } from '@/lib/types'
import { fmtMs, resolverReliabilityScore } from '@/lib/utils'
import { useI18n } from '@/lib/useI18n'

export interface QuickCheckPanelProps {
  status: BenchmarkStatus | null
  error: string | null
  systemDns: SystemDnsPayload | null
  resolverCount: number
  onStart: () => void
  onApply: () => void
  onOpenLab: () => void
}

interface VerdictModel {
  recommended: ResolverResult
  good: boolean
  currentEval: ResolverResult | null
  improvementMs: number | null
  rank: number
  reliabilityPct: number
  reasonMedian: string
  reasonFailures: string
  reasonStability: string
  title: string
}

export function QuickCheckPanel({ status, error, systemDns, resolverCount, onStart, onApply, onOpenLab }: QuickCheckPanelProps) {
  const { t } = useI18n()

  const isRunning = status?.status === 'running' || status?.status === 'queued'
  const isFailed = status?.status === 'failed' || status?.status === 'cancelled'
  const isDone = status?.status === 'done'

  const verdict = useMemo<VerdictModel | null>(() => {
    if (!isDone || !status) return null
    const recommended = resolveRecommendedResult(status)
    if (!recommended) return null
    const ranking = status.results ?? []
    const systemResolvers = systemDns?.resolvers ?? []
    const good = systemResolvers.includes(recommended.resolver)
    const currentEval = ranking.find((row) => systemResolvers.includes(row.resolver)) ?? null
    const rankIndex = ranking.findIndex((row) => row.resolver === recommended.resolver)
    const rank = rankIndex >= 0 ? rankIndex + 1 : ranking.length
    const reliabilityPct = resolverReliabilityScore(recommended) * 100
    const medianLabel = fmtMs(recommended.stats.median_ms)
    const improvementMs =
      currentEval && recommended.stats.score_latency !== null && currentEval.stats.score_latency !== null
        ? currentEval.stats.score_latency - recommended.stats.score_latency
        : null
    const queries = (recommended.stats.ok_count ?? 0) + (recommended.stats.failure_count ?? 0)

    const reasonMedian =
      !good && currentEval && improvementMs !== null
        ? t('quick.reason.medianSwitch', { ms: medianLabel, delta: fmtMs(improvementMs) })
        : t('quick.reason.medianGood', { ms: medianLabel, count: Math.max(0, ranking.length - rank), total: ranking.length })
    const reasonFailures = t('quick.reason.failures', {
      count: recommended.stats.failure_count,
      queries,
    })
    const stabilityPct = (recommended.stats.score_stability ?? resolverReliabilityScore(recommended)) * 100
    const reasonStability = t('quick.reason.stability', {
      pct: stabilityPct.toFixed(1),
      runs: status.runs,
    })

    let title: string
    if (good) {
      title = t('quick.verdict.good')
    } else if (currentEval && improvementMs !== null && improvementMs > 0) {
      const pct = Math.round((improvementMs / currentEval.stats.score_latency!) * 100)
      title = t('quick.verdict.switch', { provider: recommended.provider_name, pct })
    } else {
      title = t('quick.verdict.switchFallback', { provider: recommended.provider_name })
    }

    return {
      recommended,
      good,
      currentEval,
      improvementMs,
      rank,
      reliabilityPct,
      reasonMedian,
      reasonFailures,
      reasonStability,
      title,
    }
  }, [isDone, status, systemDns?.resolvers, t])

  const failureMessage = status?.error ?? error

  return (
    <section className="quick-panel" aria-label={t('mode.quick')}>
      <p className="quick-intro">{t('quick.intro')}</p>
      <button type="button" className="btn-primary btn-chamfer quick-check-btn" onClick={onStart} disabled={isRunning}>
        {t('quick.check')}
      </button>

      {isRunning && (
        <p className="measuring">
          <span className="measuring-dot" aria-hidden="true" />
          {t('quick.measuring', { count: resolverCount })}
        </p>
      )}

      {isDone && verdict && (
        <article className="verdict-card verdict run-complete" aria-live="polite">
          <p className="rv rv-0 verdict-eyebrow">
            {t('quick.verdict.eyebrow', { id: status.id.slice(0, 8) })}
          </p>
          <h2 className="rv rv-1 verdict-line">{verdict.title}</h2>
          <ul className="rv rv-2 verdict-reasons">
            <li>{verdict.reasonMedian}</li>
            <li>{verdict.reasonFailures}</li>
            <li>{verdict.reasonStability}</li>
          </ul>
          <div className="rv rv-3 numbers-row">
            <div className="num-cell">
              <span className="num-label">{t('quick.numbers.median')}</span>
              <span className="num-value pulse-key">{fmtMs(verdict.recommended.stats.median_ms)}</span>
            </div>
            <div className="num-cell">
              <span className="num-label">{t('quick.numbers.p95')}</span>
              <span className="num-value">{fmtMs(verdict.recommended.stats.p95_ms)}</span>
            </div>
            <div className="num-cell">
              <span className="num-label">{t('quick.numbers.failureRate')}</span>
              <span className="num-value">{(verdict.recommended.stats.failure_rate * 100).toFixed(1)}%</span>
            </div>
            <div className="num-cell">
              <span className="num-label">{t('quick.numbers.score')}</span>
              <span className="num-value">
                {verdict.recommended.stats.score_total === null
                  ? t('summary.na')
                  : `${(verdict.recommended.stats.score_total * 100).toFixed(0)} / 100`}
              </span>
            </div>
          </div>
          <div className="rv rv-4 verdict-actions">
            <button type="button" className="btn-primary btn-chamfer" onClick={onApply}>
              {t('quick.apply')}
            </button>
            <button type="button" className="btn-lab" onClick={onOpenLab}>
              {t('quick.openLab')}
            </button>
          </div>
        </article>
      )}

      {isDone && !verdict && (
        <section className="card compact quick-no-verdict" role="status">
          <h3>{t('noRanking.title')}</h3>
          <p>{t('noRanking.text')}</p>
          <button type="button" className="btn-secondary" onClick={onStart}>
            {t('quick.retry')}
          </button>
        </section>
      )}

      {isFailed && (
        <section className="card compact quick-error" role="alert">
          <h3>{t('quick.error.title')}</h3>
          <p>{failureMessage ?? t('status.pending')}</p>
          <button type="button" className="btn-secondary" onClick={onStart}>
            {t('quick.retry')}
          </button>
        </section>
      )}
    </section>
  )
}
