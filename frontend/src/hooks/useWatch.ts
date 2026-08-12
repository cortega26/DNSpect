import { useCallback, useEffect, useState } from 'react'

import { createWatch, deleteWatch, getWatches } from '@/lib/api'
import type { WatchConfigPayload, WatchEntry } from '@/lib/types'

import { useRefresh } from './useRefresh'

const POLL_INTERVAL_MS = 10_000

export interface WatchState {
  watches: WatchEntry[]
  watchesLoading: boolean
  watchesError: string | null
  refresh: () => Promise<void>
  create: (payload: WatchConfigPayload) => Promise<void>
  remove: (watchId: string) => Promise<void>
}

export function useWatch(): WatchState {
  const [watches, setWatches] = useState<WatchEntry[]>([])
  const [watchesLoading, setWatchesLoading] = useState(true)
  const [watchesError, setWatchesError] = useState<string | null>(null)
  const { refresh, abort } = useRefresh(async (signal, isCurrent) => {
    setWatchesLoading(true)
    try {
      const response = await getWatches(signal)
      if (!isCurrent()) return
      setWatches(response.watches)
      setWatchesError(null)
    } catch (e) {
      if (signal.aborted || !isCurrent()) return
      setWatchesError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (isCurrent()) setWatchesLoading(false)
    }
  })

  useEffect(() => {
    void refresh()

    const pollIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    const intervalId = window.setInterval(pollIfVisible, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', pollIfVisible)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', pollIfVisible)
      abort()
    }
  }, [refresh, abort])

  const create = useCallback(
    async (payload: WatchConfigPayload) => {
      await createWatch(payload)
      setWatchesError(null)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (watchId: string) => {
      await deleteWatch(watchId)
      setWatchesError(null)
      await refresh()
    },
    [refresh],
  )

  return { watches, watchesLoading, watchesError, refresh, create, remove }
}
