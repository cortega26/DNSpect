import { useCallback, useEffect, useRef, useState } from 'react'

import { getProtocolComparison, preflightProtocolComparison, startProtocolComparison } from '@/lib/api'
import type { ProtocolComparisonPreflight, ProtocolComparisonStartPayload, ProtocolComparisonStatus } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'

import { usePolling } from './usePolling'

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
  const activeComparisonIdRef = useRef<string | null>(null)
  const pollFailedRef = useRef(false)
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

  const fetchFn = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      const id = activeComparisonIdRef.current
      if (!id) return false
      try {
        const next = await getProtocolComparison(id, signal)
        if (signal.aborted) return false
        setComparison(next)
        setComparisonLoading(false)
        if (pollFailedRef.current) {
          pollFailedRef.current = false
          setComparisonError(null)
        }
        return next.status === 'running' || next.status === 'queued'
      } catch (e) {
        if (signal.aborted) throw e
        pollFailedRef.current = true
        setComparisonError(e instanceof Error ? e.message : t('error.protocolComparePoll'))
        setComparisonLoading(false)
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
      activeComparisonIdRef.current = id
      return startPolling()
    },
    [startPolling],
  )

  useEffect(() => {
    if (!comparisonId) {
      stopPolling()
      return
    }
    return startPollingFor(comparisonId)
  }, [comparisonId, startPollingFor, stopPolling])

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
