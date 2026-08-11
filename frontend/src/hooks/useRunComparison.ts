import { useCallback, useEffect, useRef, useState } from 'react'

import { compareRuns } from '@/lib/api'
import type { RunComparisonResponse } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'

export interface RunComparisonState {
  baselineId: string | null
  candidateId: string | null
  comparison: RunComparisonResponse | null
  comparisonLoading: boolean
  comparisonError: string | null
  selectPair: (baselineId: string | null, candidateId: string | null) => void
  clear: () => void
}

export function useRunComparison(): RunComparisonState {
  const { t } = useI18n()
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const [candidateId, setCandidateId] = useState<string | null>(null)
  const [comparison, setComparison] = useState<RunComparisonResponse | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)

  const requestSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const selectPair = useCallback((nextBaseline: string | null, nextCandidate: string | null) => {
    setBaselineId(nextBaseline)
    setCandidateId(nextCandidate)
    if (nextBaseline === null || nextCandidate === null) {
      requestSeqRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      setComparison(null)
      setComparisonError(null)
      setComparisonLoading(false)
    }
  }, [])

  useEffect(() => {
    if (baselineId === null || candidateId === null) return

    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setComparisonLoading(true)
    setComparisonError(null)

    void (async () => {
      try {
        const response = await compareRuns(baselineId, candidateId, controller.signal)
        if (requestSeq !== requestSeqRef.current) return
        setComparison(response)
      } catch (e) {
        if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return
        setComparisonError(e instanceof Error ? e.message : t('error.benchmarkCompare'))
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setComparisonLoading(false)
          abortRef.current = null
        }
      }
    })()
  }, [baselineId, candidateId, t])

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const clear = useCallback(() => {
    requestSeqRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setBaselineId(null)
    setCandidateId(null)
    setComparison(null)
    setComparisonError(null)
    setComparisonLoading(false)
  }, [])

  return { baselineId, candidateId, comparison, comparisonLoading, comparisonError, selectPair, clear }
}
