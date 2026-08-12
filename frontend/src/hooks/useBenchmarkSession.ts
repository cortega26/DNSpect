import { useCallback, useEffect, useRef, useState } from 'react'

import { getBenchmark, startBenchmark } from '@/lib/api'
import { shouldAcceptAsyncResult, shouldPollBenchmark } from '@/lib/runtime'
import type { BenchmarkMode, BenchmarkProtocol, BenchmarkStatus, Goal, ResolverResult, ScoringProfile, TargetSnapshot } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'

import { usePolling } from './usePolling'

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

  const activePollBenchmarkIdRef = useRef<string | null>(null)
  const startRequestSeqRef = useRef(0)
  const startInFlightRef = useRef(false)
  const selectRequestSeqRef = useRef(0)
  const pollFailedRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchFn = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      const id = activePollBenchmarkIdRef.current
      if (!id) return false
      try {
        const next = await getBenchmark(id, false, signal)
        if (signal.aborted) return false
        setStatus(next)
        if (pollFailedRef.current) {
          pollFailedRef.current = false
          setError(null)
        }
        return next.status === 'running' || next.status === 'queued'
      } catch (e) {
        if (signal.aborted) throw e
        pollFailedRef.current = true
        setError(e instanceof Error ? e.message : t('error.benchmarkPoll'))
        throw e
      }
    },
    [t],
  )

  const { start: startPolling, stop: stopPolling } = usePolling({
    fetchFn,
    intervalMs: POLL_INTERVAL_MS,
    shouldContinue: () => mountedRef.current,
  })

  const startPollingFor = useCallback(
    (id: string) => {
      activePollBenchmarkIdRef.current = id
      return startPolling()
    },
    [startPolling],
  )

  useEffect(() => {
    if (!shouldPollBenchmark(benchmarkId, viewingSavedRun)) {
      stopPolling()
      return
    }
    return startPollingFor(benchmarkId)
  }, [benchmarkId, startPollingFor, stopPolling, viewingSavedRun])

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

  const viewSavedRun = useCallback(
    (payload: BenchmarkStatus) => {
      stopPolling()
      setError(null)
      setSelectedResult(null)
      setLoadingSamples(false)
      setStatus(payload)
      setBenchmarkId(payload.id)
      setViewingSavedRun(true)
    },
    [stopPolling],
  )

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
