import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { useI18n } from '@/lib/i18n'
import type { ResolverResult } from '@/lib/types'
import { fmtMs, resolverReliabilityScore } from '@/lib/utils'

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
      label.textContent = t('liveRanking.updatedAgo', { seconds: elapsedSeconds.toFixed(1) })
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
  confidencePct: number
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

  const isMotionBudgetExceeded = ranking.length > Math.max(1, motionRowBudget)
  const allowReorderAnimation = !prefersReducedMotion && !isMotionBudgetExceeded
  const allowHighlights = !isMotionBudgetExceeded
  const updatedLabelIntervalMs = isMotionBudgetExceeded || prefersReducedMotion ? 1000 : 500

  const decoratedRows = useMemo(() => {
    return ranking.map<DecoratedRankRow>((row, index) => {
      const previousRank = previousRankRef.current.get(row.ip)
      const movementDelta = previousRank === undefined ? 0 : previousRank - index
      const previousSequence = movementSequenceRef.current.get(row.ip) ?? 0
      const movementSequence = movementDelta === 0 ? previousSequence : previousSequence + 1
      movementSequenceRef.current.set(row.ip, movementSequence)

      const confidence = expectedSamples > 0 ? Math.min(1, row.samplesCompleted / expectedSamples) : 1

      return {
        ...row,
        confidence,
        confidencePct: Math.round(confidence * 100),
        isEntering: previousRank === undefined,
        isActive: Boolean(currentResolver && row.ip === currentResolver),
        isLeader: index === 0,
        movementDelta,
        movementSequence,
      }
    })
  }, [currentResolver, expectedSamples, ranking])

  useLayoutEffect(() => {
    const nextTopMap = new Map<string, number>()
    for (const row of ranking) {
      const node = rowElementRef.current.get(row.ip)
      if (!node) continue
      nextTopMap.set(row.ip, node.getBoundingClientRect().top)
    }

    if (!allowReorderAnimation) {
      previousTopRef.current = nextTopMap
      return
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
        <p className="muted">{t('liveRanking.waiting')}</p>
      ) : (
        <ol className="live-ranking-list">
          {decoratedRows.map((row, index) => {
            const provisional = row.confidence < 1
            const rankDeltaText =
              row.movementDelta > 0 ? `↑${row.movementDelta}` : row.movementDelta < 0 ? `↓${Math.abs(row.movementDelta)}` : ''
            const confidenceBand =
              row.confidence < 0.3 ? 'live-ranking-confidence-fill-low' : row.confidence < 0.8 ? 'live-ranking-confidence-fill-medium' : 'live-ranking-confidence-fill-high'
            const rowStyle = !allowReorderAnimation || row.movementDelta === 0
              ? undefined
              : ({
                  '--rank-row-change-animation': row.movementSequence % 2 === 0 ? 'rank-row-change-a' : 'rank-row-change-b',
                } as CSSProperties)
            const deltaStyle = !allowReorderAnimation || row.movementDelta === 0
              ? undefined
              : ({
                  '--rank-delta-change-animation': row.movementSequence % 2 === 0 ? 'rank-delta-change-a' : 'rank-delta-change-b',
                } as CSSProperties)
            return (
              <li
                key={row.ip}
                ref={(node) => {
                  if (node) rowElementRef.current.set(row.ip, node)
                  else rowElementRef.current.delete(row.ip)
                }}
                className={[
                  'live-ranking-row',
                  allowReorderAnimation && row.movementDelta !== 0 ? 'is-rank-changing' : '',
                  allowReorderAnimation && row.isEntering ? 'is-entering' : '',
                  allowHighlights && row.isActive ? 'is-active' : '',
                  allowHighlights && row.isLeader && isRunning ? 'is-running-leader' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={rowStyle}
              >
                <span className="live-ranking-accent" aria-hidden="true" />
                <span className="live-ranking-rank">#{index + 1}</span>
                <div className="live-ranking-main">
                  <strong>
                    {row.name} - {row.ip}
                  </strong>
                  <span className="muted">
                    Score: {Number.isFinite(row.scoreTotal) ? row.scoreTotal.toFixed(3) : 'NA'} · {fmtMs(row.scoreLatency)} ·{' '}
                    {(row.reliability * 100).toFixed(1)}%
                    {provisional ? ` (${t('liveRanking.provisional')})` : ''}
                  </span>
                  <span className="live-ranking-confidence" role="presentation" aria-hidden="true">
                    <span
                      className={['live-ranking-confidence-fill', confidenceBand].join(' ')}
                      style={{ width: `${row.confidencePct}%` }}
                    />
                  </span>
                </div>
                <span
                  className={[
                    'live-ranking-delta',
                    isMotionBudgetExceeded ? 'is-text-only' : '',
                    row.movementDelta > 0 ? 'is-up' : row.movementDelta < 0 ? 'is-down' : 'is-idle',
                  ].join(' ')}
                  style={deltaStyle}
                  aria-hidden={row.movementDelta === 0}
                >
                  {rankDeltaText || '\u00A0'}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
