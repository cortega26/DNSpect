import { useCallback, useEffect, useRef, useState } from 'react'

import { getBenchmarkHistory, type RunHistoryEntry } from '@/lib/api'

export interface RunHistory {
  history: RunHistoryEntry[]
  historyLoading: boolean
  refresh: () => Promise<void>
}

export function useRunHistory(sessionStatusId: string | null): RunHistory {
  const [history, setHistory] = useState<RunHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const refreshSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    const requestSeq = refreshSeqRef.current + 1
    refreshSeqRef.current = requestSeq
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setHistoryLoading(true)
    try {
      const response = await getBenchmarkHistory(controller.signal)
      if (requestSeq !== refreshSeqRef.current) return
      setHistory(response.runs)
    } catch {
      if (controller.signal.aborted || requestSeq !== refreshSeqRef.current) return
    } finally {
      if (requestSeq === refreshSeqRef.current) {
        setHistoryLoading(false)
        abortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      refreshSeqRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [refresh, sessionStatusId])

  return { history, historyLoading, refresh }
}
