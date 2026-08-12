import { useCallback, useEffect, useRef, useState } from 'react'

import { getBenchmark, startBenchmark } from '@/lib/api'
import { isActivePollSession, shouldAcceptAsyncResult, shouldPollBenchmark } from '@/lib/runtime'
import type { BenchmarkMode, BenchmarkProtocol, BenchmarkStatus, Goal, ResolverResult, ScoringProfile, TargetSnapshot } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'

export interface BenchmarkStartPayload {
  mode: BenchmarkMode
  goal?: Goal
  scoring_profile?: ScoringProfile
  protocol?: BenchmarkProtocol
  runs?: number
  timeout_sec: number
  resolvers: string[]
  queries?: string[]
  target_snapshot?: TargetSnapshot | null
}

const POLL_INTERVAL_MS = 1000

export interface BenchmarkSession {
  benchmarkId: string | null
  status: BenchmarkStatus | null
  viewingSavedRun: boolean
  selectedResult: ResolverResult | null
  loadingSamples: boolean
  error: string | null
  reportError: (message: string) => void
  start: (payload: BenchmarkStartPayload) => Promise<void>
  selectRun: (runId: string) => Promise<void>
  selectResult: (result: ResolverResult | null) => void
  loadSamples: () => Promise<void>
  viewSavedRun: (payload: BenchmarkStatus) => void
}

export function useBenchmarkSession(): BenchmarkSession {
  const { t } = useI18n()

  const [benchmarkId, setBenchmarkId] = useState<string | null>(null)
  const [status, setStatus] = useState<BenchmarkStatus | null>(null)
  const [viewingSavedRun, setViewingSavedRun] = useState(false)
  const [selectedResult, setSelectedResult] = useState<ResolverResult | null>(null)
  const [loadingSamples, setLoadingSamples] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pollTimerRef = useRef<number | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const pollInFlightRef = useRef(false)
  const pollSessionIdRef = useRef(0)
  const activePollBenchmarkIdRef = useRef<string | null>(null)
  const startRequestSeqRef = useRef(0)
  const startInFlightRef = useRef(false)
  const selectRequestSeqRef = useRef(0)
  const consecutiveErrorsRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
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
    activePollBenchmarkIdRef.current = null
  }, [])

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      activePollBenchmarkIdRef.current = id
      const sessionId = pollSessionIdRef.current
      let cancelled = false

      const isCurrentSession = () =>
        !cancelled &&
        isActivePollSession(sessionId, pollSessionIdRef.current, id, activePollBenchmarkIdRef.current) &&
        mountedRef.current

      const scheduleNext = (delayMs: number) => {
        if (!isCurrentSession()) return
        pollTimerRef.current = window.setTimeout(() => {
          void pollOnce()
        }, delayMs)
      }

      const pollOnce = async () => {
        if (!isCurrentSession()) return
        if (pollInFlightRef.current) {
          scheduleNext(120)
          return
        }

        pollInFlightRef.current = true
        const controller = new AbortController()
        pollAbortRef.current = controller

        try {
          const next = await getBenchmark(id, false, controller.signal)
          if (!isCurrentSession()) return
          setStatus(next)
          consecutiveErrorsRef.current = 0
          if (next.status === 'running' || next.status === 'queued') {
            scheduleNext(POLL_INTERVAL_MS)
          } else {
            stopPolling()
          }
        } catch (e) {
          if (controller.signal.aborted || !isCurrentSession()) return
          consecutiveErrorsRef.current += 1
          setError(e instanceof Error ? e.message : t('error.benchmarkPoll'))
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
        if (isActivePollSession(sessionId, pollSessionIdRef.current, id, activePollBenchmarkIdRef.current)) {
          stopPolling()
        }
      }
    },
    [stopPolling, t],
  )

  useEffect(() => {
    if (!shouldPollBenchmark(benchmarkId, viewingSavedRun)) {
      stopPolling()
      return
    }
    return startPolling(benchmarkId)
  }, [benchmarkId, startPolling, stopPolling, viewingSavedRun])

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  const reportError = useCallback((message: string) => {
    setError(message)
  }, [])

  const start = useCallback(
    async (payload: BenchmarkStartPayload) => {
      if (startInFlightRef.current) return
      startInFlightRef.current = true

      const requestSeq = startRequestSeqRef.current + 1
      startRequestSeqRef.current = requestSeq
      selectRequestSeqRef.current += 1

      setError(null)
      setSelectedResult(null)
      setViewingSavedRun(false)
      stopPolling()
      setStatus(null)
      setBenchmarkId(null)

      try {
        const response = await startBenchmark(payload)
        if (!shouldAcceptAsyncResult(requestSeq, startRequestSeqRef.current, mountedRef.current)) return
        setBenchmarkId(response.benchmark_id)
      } catch (e) {
        if (!shouldAcceptAsyncResult(requestSeq, startRequestSeqRef.current, mountedRef.current)) return
        setError(e instanceof Error ? e.message : t('error.benchmarkStart'))
      } finally {
        startInFlightRef.current = false
      }
    },
    [stopPolling, t],
  )

  const selectRun = useCallback(
    async (runId: string) => {
      stopPolling()
      const requestSeq = selectRequestSeqRef.current + 1
      selectRequestSeqRef.current = requestSeq
      try {
        const pastRun = await getBenchmark(runId)
        if (!shouldAcceptAsyncResult(requestSeq, selectRequestSeqRef.current, mountedRef.current)) return
        setStatus(pastRun)
        setBenchmarkId(runId)
        setViewingSavedRun(true)
        setError(null)
        setSelectedResult(null)
      } catch (e) {
        if (!shouldAcceptAsyncResult(requestSeq, selectRequestSeqRef.current, mountedRef.current)) return
        setError(e instanceof Error ? e.message : t('error.benchmarkLoad'))
      }
    },
    [stopPolling, t],
  )

  const selectResult = useCallback((result: ResolverResult | null) => {
    selectRequestSeqRef.current += 1
    setSelectedResult(result)
  }, [])

  const loadSamples = useCallback(async () => {
    if (!benchmarkId || !selectedResult || selectedResult.samples.length > 0 || loadingSamples) return
    const requestSeq = selectRequestSeqRef.current + 1
    selectRequestSeqRef.current = requestSeq
    const targetResolver = selectedResult.resolver
    setLoadingSamples(true)
    try {
      const full = await getBenchmark(benchmarkId, true)
      if (!shouldAcceptAsyncResult(requestSeq, selectRequestSeqRef.current, mountedRef.current)) return
      const resolved = full.results?.find((row) => row.resolver === targetResolver)
      if (resolved) {
        setSelectedResult(resolved)
      }
    } catch (e) {
      if (!shouldAcceptAsyncResult(requestSeq, selectRequestSeqRef.current, mountedRef.current)) return
      setError(e instanceof Error ? e.message : t('error.samples'))
    } finally {
      if (requestSeq === selectRequestSeqRef.current) {
        setLoadingSamples(false)
      }
    }
  }, [benchmarkId, loadingSamples, selectedResult, t])

  const viewSavedRun = useCallback((payload: BenchmarkStatus) => {
    stopPolling()
    setError(null)
    setSelectedResult(null)
    setLoadingSamples(false)
    setStatus(payload)
    setBenchmarkId(payload.id)
    setViewingSavedRun(true)
  }, [stopPolling])

  return {
    benchmarkId,
    status,
    viewingSavedRun,
    selectedResult,
    loadingSamples,
    error,
    reportError,
    start,
    selectRun,
    selectResult,
    loadSamples,
    viewSavedRun,
  }
}
