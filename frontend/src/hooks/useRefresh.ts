import { useCallback, useRef } from 'react'

/**
 * Shared refresh helper (plan 038).
 *
 * Serializes a caller-owned fetch: each call aborts the previous request,
 * bumps a sequence counter, and hands the fetcher an `isCurrent()` guard so
 * stale responses (superseded or aborted fetches) are dropped without
 * touching state. `abort()` invalidates the in-flight fetch and is used by
 * the callers' effect cleanups.
 */

export interface RefreshHandle {
  refresh: () => Promise<void>
  abort: () => void
}

export function useRefresh(
  fetcher: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>,
): RefreshHandle {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    const requestSeq = seqRef.current + 1
    seqRef.current = requestSeq
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const isCurrent = () => requestSeq === seqRef.current
    try {
      await fetcherRef.current(controller.signal, isCurrent)
    } finally {
      if (requestSeq === seqRef.current) {
        abortRef.current = null
      }
    }
  }, [])

  const abort = useCallback(() => {
    seqRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { refresh, abort }
}
