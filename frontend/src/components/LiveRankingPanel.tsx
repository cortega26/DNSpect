import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/lib/useI18n'
import { resolveLiveMotionPolicy } from '@/lib/motion'
import type { ResolverResult } from '@/lib/types'
import { resolverReliabilityScore } from '@/lib/utils'

interface CanonicalLiveRow {
  ip: string
  name: string
  samplesCompleted: number
  scoreTotal: number
  scoreLatency: number | null
  scoreStability: number | null
  reliability: number
}

interface Props {
  results: ResolverResult[]
  expectedSamples: number
  isRunning: boolean
  currentResolver: string | null
  motionRowBudget?: number
}

const REORDER_DURATION_MS = 280
const DEFAULT_MOTION_ROW_BUDGET = 30

interface UpdatedAgoLabelProps {
  updatedAtMs: number
  isRunning: boolean
  intervalMs: number
}

const UpdatedAgoLabel = memo(function UpdatedAgoLabel({ updatedAtMs, isRunning, intervalMs }: UpdatedAgoLabelProps) {
  const { t } = useI18n()
  const labelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const label = labelRef.current
    if (!label) return

    const renderElapsed = () => {
      const elapsedSeconds = Math.max(0, (Date.now() - updatedAtMs) / 1000)
      label.textContent = t('liveRanking.updatedAgo', { seconds: Math.floor(elapsedSeconds) })
    }

    renderElapsed()
    if (!isRunning) return

    const timer = window.setInterval(renderElapsed, intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, isRunning, t, updatedAtMs])

  return <span ref={labelRef} className="live-ranking-updated" aria-live="off" />
})

interface DecoratedRankRow extends CanonicalLiveRow {
  confidence: number
  qualityPct: number
  isEntering: boolean
  isActive: boolean
  isLeader: boolean
  movementDelta: number
  movementSequence: number
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(media.matches)
    update()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener(update)
    return () => media.removeListener(update)
  }, [])

  return prefersReducedMotion
}

export function LiveRankingPanel({
  results,
  expectedSamples,
  isRunning,
  currentResolver,
  motionRowBudget = DEFAULT_MOTION_ROW_BUDGET,
}: Props) {
  const { t } = useI18n()
  const prefersReducedMotion = usePrefersReducedMotion()
  const previousRankRef = useRef<Map<string, number>>(new Map())
  const movementSequenceRef = useRef<Map<string, number>>(new Map())
  const rowElementRef = useRef<Map<string, HTMLLIElement>>(new Map())
  const previousTopRef = useRef<Map<string, number>>(new Map())
  const rankingIdentityRef = useRef<CanonicalLiveRow[] | null>(null)
  const rankingUpdatedAtRef = useRef<number>(Date.now())

  const ranking = useMemo(() => {
    const rows: CanonicalLiveRow[] = results
      .map((result) => {
        const samplesCompleted = Math.max(0, result.sample_count ?? result.samples.length)
        const scoreTotal = result.stats.score_total ?? Number.POSITIVE_INFINITY
        const scoreLatency = result.stats.score_latency
        const scoreStability = result.stats.score_stability
        const reliability = resolverReliabilityScore(result)

        return {
          ip: result.resolver,
          name: result.provider_name,
          samplesCompleted,
          scoreTotal,
          scoreLatency,
          scoreStability,
          reliability,
        }
      })
      .filter((row) => row.samplesCompleted > 0)

    return rows
  }, [results])

  if (rankingIdentityRef.current !== ranking) {
    rankingIdentityRef.current = ranking
    rankingUpdatedAtRef.current = Date.now()
  }

  const liveMotionPolicy = resolveLiveMotionPolicy(ranking.length, motionRowBudget, prefersReducedMotion)
  const { isMotionBudgetExceeded, allowReorderAnimation, allowHighlights, updatedLabelIntervalMs } = liveMotionPolicy

  const decoratedRows = useMemo(() => {
    const finiteScores = ranking.map((row) => row.scoreTotal).filter((score) => Number.isFinite(score))
    const bestScore = finiteScores.length > 0 ? Math.min(...finiteScores) : null
    const worstScore = finiteScores.length > 0 ? Math.max(...finiteScores) : null
    const scoreSpan =
      bestScore !== null && worstScore !== null ? Math.max(0, worstScore - bestScore) : null

    return ranking.map<DecoratedRankRow>((row, index) => {
      const previousRank = previousRankRef.current.get(row.ip)
      const movementDelta = previousRank === undefined ? 0 : previousRank - index
      const previousSequence = movementSequenceRef.current.get(row.ip) ?? 0
      const movementSequence = movementDelta === 0 ? previousSequence : previousSequence + 1
      movementSequenceRef.current.set(row.ip, movementSequence)

      const confidence = expectedSamples > 0 ? Math.min(1, row.samplesCompleted / expectedSamples) : 1
      let qualityPct = 0
      if (Number.isFinite(row.scoreTotal)) {
        if (scoreSpan === null || scoreSpan <= 0 || bestScore === null || worstScore === null) {
          qualityPct = 100
        } else {
          const normalizedQuality = ((worstScore - row.scoreTotal) / scoreSpan) * 100
          qualityPct = Math.max(6, Math.min(100, normalizedQuality))
        }
      }

      return {
        ...row,
        confidence,
        qualityPct,
        isEntering: previousRank === undefined,
        isActive: Boolean(currentResolver && row.ip === currentResolver),
        isLeader: index === 0,
        movementDelta,
        movementSequence,
      }
    })
  }, [currentResolver, expectedSamples, ranking])

  useLayoutEffect(() => {
    if (!allowReorderAnimation) {
      previousTopRef.current.clear()
      return
    }

    const nextTopMap = new Map<string, number>()
    for (const row of ranking) {
      const node = rowElementRef.current.get(row.ip)
      if (!node) continue
      nextTopMap.set(row.ip, node.getBoundingClientRect().top)
    }

    const previousTopMap = previousTopRef.current
    const transitions: Array<{ node: HTMLLIElement; offsetY: number }> = []

    for (const row of ranking) {
      const node = rowElementRef.current.get(row.ip)
      if (!node) continue

      const nextTop = node.getBoundingClientRect().top
      nextTopMap.set(row.ip, nextTop)

      const previousTop = previousTopMap.get(row.ip)
      if (previousTop === undefined) continue

      const offsetY = previousTop - nextTop
      if (Math.abs(offsetY) < 1) continue
      transitions.push({ node, offsetY })
    }

    for (const transition of transitions) {
      transition.node.style.transition = 'none'
      transition.node.style.transform = `translateY(${transition.offsetY}px)`
    }

    let frame = 0
    if (transitions.length > 0) {
      frame = window.requestAnimationFrame(() => {
        for (const transition of transitions) {
          transition.node.style.transition = `transform ${REORDER_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease`
          transition.node.style.transform = 'translateY(0)'
        }
      })
    }

    previousTopRef.current = nextTopMap

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [allowReorderAnimation, ranking])

  useEffect(() => {
    const activeIps = new Set(ranking.map((row) => row.ip))
    for (const ip of movementSequenceRef.current.keys()) {
      if (!activeIps.has(ip)) movementSequenceRef.current.delete(ip)
    }
    for (const ip of previousTopRef.current.keys()) {
      if (!activeIps.has(ip)) previousTopRef.current.delete(ip)
    }
    previousRankRef.current = new Map(ranking.map((row, index) => [row.ip, index]))
  }, [ranking])

  return (
    <section
      className={['live-ranking-panel', isMotionBudgetExceeded ? 'is-motion-budgeted' : ''].filter(Boolean).join(' ')}
      aria-live="polite"
    >
      <div className="live-ranking-header">
        <div className="live-ranking-title-row">
          {isRunning ? (
            <span className="live-ranking-chip" role="status" aria-label={t('liveRanking.live')}>
              <span className="live-ranking-chip-dot" aria-hidden="true" />
              {t('liveRanking.live')}
            </span>
          ) : null}
          <h4>{t('liveRanking.title')}</h4>
          <UpdatedAgoLabel updatedAtMs={rankingUpdatedAtRef.current} isRunning={isRunning} intervalMs={updatedLabelIntervalMs} />
        </div>
        <p>{t('liveRanking.subtitle')}</p>
      </div>
      {ranking.length === 0 ? (
        <div className="live-ranking-waiting">
          <div className="live-ranking-waiting-bars" aria-hidden="true">
            <span className="live-ranking-waiting-bar" />
            <span className="live-ranking-waiting-bar" />
            <span className="live-ranking-waiting-bar" />
            <span className="live-ranking-waiting-bar" />
            <span className="live-ranking-waiting-bar" />
          </div>
          <p className="muted">
            {isRunning
              ? t('liveRanking.waitingSamples', { count: expectedSamples })
              : t('liveRanking.waiting')}
          </p>
        </div>
      ) : (
        <ol className="live-ranking-list">
          {decoratedRows.map((row, index) => (
            <li
              key={row.ip}
              ref={(node) => {
                if (node) rowElementRef.current.set(row.ip, node)
                else rowElementRef.current.delete(row.ip)
              }}
              className={[
                'live-ranking-row',
                'race-row',
                allowReorderAnimation && row.isEntering ? 'is-entering' : '',
                allowHighlights && row.isActive ? 'is-active' : '',
                allowHighlights && row.isLeader && isRunning ? 'is-running-leader' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="live-ranking-rank">#{index + 1}</span>
              <div className="race-bar-track">
                <div
                  className={[
                    'race-bar-fill',
                    index === 0 ? 'race-bar-fill-rank-1' : '',
                    index === 1 ? 'race-bar-fill-rank-2' : '',
                    index === 2 ? 'race-bar-fill-rank-3' : '',
                    row.confidence < 1 ? 'is-provisional' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ width: `${row.qualityPct.toFixed(1)}%` }}
                />
                <span className="race-bar-name">{row.name} - {row.ip}</span>
              </div>
              <span className="race-bar-pct">{row.qualityPct.toFixed(0)}%</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
