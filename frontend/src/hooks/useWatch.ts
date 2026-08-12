import { useCallback, useEffect, useRef, useState } from 'react'

import { createWatch, deleteWatch, getWatches } from '@/lib/api'
import type { WatchConfigPayload, WatchEntry } from '@/lib/types'

export interface WatchState {
  watches: WatchEntry[]
  watchesLoading: boolean
  refresh: () => Promise<void>
  create: (payload: WatchConfigPayload) => Promise<void>
  remove: (watchId: string) => Promise<void>
}

export function useWatch(): WatchState {
  const [watches, setWatches] = useState<WatchEntry[]>([])
  const [watchesLoading, setWatchesLoading] = useState(true)
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
    } catch {
      if (controller.signal.aborted || requestSeq !== refreshSeqRef.current) return
    } finally {
      if (requestSeq === refreshSeqRef.current) {
        setWatchesLoading(false)
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
  }, [refresh])

  const create = useCallback(
    async (payload: WatchConfigPayload) => {
      await createWatch(payload)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (watchId: string) => {
      await deleteWatch(watchId)
      await refresh()
    },
    [refresh],
  )

  return { watches, watchesLoading, refresh, create, remove }
}
