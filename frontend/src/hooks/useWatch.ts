import { useCallback, useEffect, useRef, useState } from 'react'

import { createWatch, deleteWatch, getWatches } from '@/lib/api'
import type { WatchConfigPayload, WatchEntry } from '@/lib/types'

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
  const refreshSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    const requestSeq = refreshSeqRef.current + 1
    refreshSeqRef.current = requestSeq
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setWatchesLoading(true)
    try {
      const response = await getWatches(controller.signal)
      if (requestSeq !== refreshSeqRef.current) return
      setWatches(response.watches)
      setWatchesError(null)
    } catch (e) {
      if (controller.signal.aborted || requestSeq !== refreshSeqRef.current) return
      setWatchesError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (requestSeq === refreshSeqRef.current) {
        setWatchesLoading(false)
        abortRef.current = null
      }
    }
  }, [])

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
      refreshSeqRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [refresh])

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
