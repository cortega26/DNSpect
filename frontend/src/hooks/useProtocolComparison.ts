import { useCallback, useEffect, useRef, useState } from 'react'

import { getProtocolComparison, preflightProtocolComparison, startProtocolComparison } from '@/lib/api'
import type { ProtocolComparisonPreflight, ProtocolComparisonStartPayload, ProtocolComparisonStatus } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'

const POLL_INTERVAL_MS = 1000

export interface ProtocolComparisonState {
  preflight: ProtocolComparisonPreflight | null
  preflightLoading: boolean
  preflightError: string | null
  comparison: ProtocolComparisonStatus | null
  comparisonId: string | null
  comparisonLoading: boolean
  comparisonError: string | null
  runPreflight: (payload: ProtocolComparisonStartPayload) => void
  start: (payload: ProtocolComparisonStartPayload) => Promise<void>
  clear: () => void
}

export function useProtocolComparison(): ProtocolComparisonState {
  const { t } = useI18n()
  const [preflightPayload, setPreflightPayload] = useState<ProtocolComparisonStartPayload | null>(null)
  const [preflight, setPreflight] = useState<ProtocolComparisonPreflight | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<ProtocolComparisonStatus | null>(null)
  const [comparisonId, setComparisonId] = useState<string | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)

  const preflightSeqRef = useRef(0)
  const preflightAbortRef = useRef<AbortController | null>(null)
  const startRequestSeqRef = useRef(0)
  const pollSessionIdRef = useRef(0)
  const pollTimerRef = useRef<number | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const pollInFlightRef = useRef(false)
  const consecutiveErrorsRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!preflightPayload) return
    const requestSeq = preflightSeqRef.current + 1
    preflightSeqRef.current = requestSeq
    preflightAbortRef.current?.abort()
    const controller = new AbortController()
    preflightAbortRef.current = controller

    setPreflightLoading(true)
    setPreflightError(null)

    void (async () => {
      try {
        const result = await preflightProtocolComparison(preflightPayload, controller.signal)
        if (requestSeq !== preflightSeqRef.current) return
        setPreflight(result)
      } catch (e) {
        if (controller.signal.aborted || requestSeq !== preflightSeqRef.current) return
        setPreflight(null)
        setPreflightError(e instanceof Error ? e.message : t('error.protocolComparePreflight'))
      } finally {
        if (requestSeq === preflightSeqRef.current) {
          setPreflightLoading(false)
          preflightAbortRef.current = null
        }
      }
    })()
  }, [preflightPayload, t])

  useEffect(() => {
    return () => {
      preflightSeqRef.current += 1
      preflightAbortRef.current?.abort()
      preflightAbortRef.current = null
    }
  }, [])

  const stopPolling = useCallback(() => {
    pollSessionIdRef.current += 1
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (pollAbortRef.current) {
      pollAbortRef.current.abort()
      pollAbortRef.current = null
    }
    pollInFlightRef.current = false
  }, [])

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      const sessionId = pollSessionIdRef.current
      let cancelled = false

      const isCurrent = () =>
        !cancelled && sessionId === pollSessionIdRef.current && mountedRef.current

      const scheduleNext = (delayMs: number) => {
        if (!isCurrent()) return
        pollTimerRef.current = window.setTimeout(() => {
          void pollOnce()
        }, delayMs)
      }

      const pollOnce = async () => {
        if (!isCurrent()) return
        if (pollInFlightRef.current) {
          scheduleNext(120)
          return
        }
        pollInFlightRef.current = true
        const controller = new AbortController()
        pollAbortRef.current = controller
        try {
          const next = await getProtocolComparison(id, controller.signal)
          if (!isCurrent()) return
          setComparison(next)
          setComparisonLoading(false)
          consecutiveErrorsRef.current = 0
          if (next.status === 'running' || next.status === 'queued') {
            scheduleNext(POLL_INTERVAL_MS)
          } else {
            stopPolling()
          }
        } catch (e) {
          if (controller.signal.aborted || !isCurrent()) return
          consecutiveErrorsRef.current += 1
          setComparisonError(e instanceof Error ? e.message : t('error.protocolComparePoll'))
          setComparisonLoading(false)
          if (consecutiveErrorsRef.current >= 5) {
            stopPolling()
          } else {
            scheduleNext(Math.min(1000 * 2 ** (consecutiveErrorsRef.current - 1), 30_000))
          }
        } finally {
          pollInFlightRef.current = false
          if (pollAbortRef.current === controller) {
            pollAbortRef.current = null
          }
        }
      }

      void pollOnce()

      return () => {
        cancelled = true
        if (sessionId === pollSessionIdRef.current) {
          stopPolling()
        }
      }
    },
    [stopPolling, t],
  )

  useEffect(() => {
    if (!comparisonId) {
      stopPolling()
      return
    }
    return startPolling(comparisonId)
  }, [comparisonId, startPolling, stopPolling])

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  const runPreflight = useCallback((payload: ProtocolComparisonStartPayload) => {
    setPreflightPayload(payload)
  }, [])

  const start = useCallback(
    async (payload: ProtocolComparisonStartPayload) => {
      stopPolling()
      const requestSeq = startRequestSeqRef.current + 1
      startRequestSeqRef.current = requestSeq
      setComparisonError(null)
      setComparisonLoading(true)
      setComparison(null)
      setComparisonId(null)
      try {
        const response = await startProtocolComparison(payload)
        if (requestSeq !== startRequestSeqRef.current || !mountedRef.current) return
        setComparisonId(response.comparison_id)
      } catch (e) {
        if (requestSeq !== startRequestSeqRef.current || !mountedRef.current) return
        setComparisonError(e instanceof Error ? e.message : t('error.protocolCompareStart'))
        setComparisonLoading(false)
      }
    },
    [stopPolling, t],
  )

  const clear = useCallback(() => {
    preflightSeqRef.current += 1
    startRequestSeqRef.current += 1
    preflightAbortRef.current?.abort()
    preflightAbortRef.current = null
    setPreflightPayload(null)
    setPreflight(null)
    setPreflightError(null)
    setPreflightLoading(false)
    stopPolling()
    setComparison(null)
    setComparisonId(null)
    setComparisonError(null)
    setComparisonLoading(false)
  }, [stopPolling])

  return {
    preflight,
    preflightLoading,
    preflightError,
    comparison,
    comparisonId,
    comparisonLoading,
    comparisonError,
    runPreflight,
    start,
    clear,
  }
}
