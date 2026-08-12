import { useEffect, useState } from 'react'

import { getBenchmarkHistory, type RunHistoryEntry } from '@/lib/api'

import { useRefresh } from './useRefresh'

export interface RunHistory {
  history: RunHistoryEntry[]
  historyLoading: boolean
  refresh: () => Promise<void>
}

export function useRunHistory(sessionStatusId: string | null): RunHistory {
  const [history, setHistory] = useState<RunHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const { refresh, abort } = useRefresh(async (signal, isCurrent) => {
    setHistoryLoading(true)
    try {
      const response = await getBenchmarkHistory(signal)
      if (!isCurrent()) return
      setHistory(response.runs)
    } catch {
      if (signal.aborted || !isCurrent()) return
    } finally {
      if (isCurrent()) setHistoryLoading(false)
    }
  })

  useEffect(() => {
    void refresh()
    return abort
  }, [refresh, abort, sessionStatusId])

  return { history, historyLoading, refresh }
}
