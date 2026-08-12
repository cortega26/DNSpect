import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shared polling engine (plan 038).
 *
 * Owns the poll timer, the in-flight guard (a poll in flight when the timer
 * fires is rescheduled after 120ms), the per-poll abort controller, the
 * consecutive-error exponential backoff, and teardown on unmount or stop.
 * The caller owns its state updates: `fetchFn` performs them and returns
 * `true` while polling should continue, `false` once the poll reached a
 * terminal condition. `shouldContinue` is the session/mount guard consulted
 * before each poll and after each in-flight request settles.
 */

export interface UsePollingBackoff {
  maxAttempts: number
  baseMs: number
  maxMs: number
}

export interface UsePollingOptions {
  fetchFn: (signal: AbortSignal) => Promise<boolean>
  shouldContinue?: () => boolean
  intervalMs?: number
  backoff?: UsePollingBackoff
}

export interface PollingControl {
  start: () => () => void
  stop: () => void
  isPolling: boolean
}

const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_BACKOFF: UsePollingBackoff = { maxAttempts: 5, baseMs: 1000, maxMs: 30_000 }
const IN_FLIGHT_RESCHEDULE_MS = 120

export function usePolling(options: UsePollingOptions): PollingControl {
  const { fetchFn, shouldContinue = () => true, intervalMs = DEFAULT_INTERVAL_MS, backoff = DEFAULT_BACKOFF } = options
  const optionsRef = useRef({ fetchFn, shouldContinue, intervalMs, backoff })
  optionsRef.current = { fetchFn, shouldContinue, intervalMs, backoff }

  const sessionIdRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const consecutiveErrorsRef = useRef(0)
  const [isPolling, setIsPolling] = useState(false)

  const stop = useCallback(() => {
    sessionIdRef.current += 1
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    inFlightRef.current = false
    consecutiveErrorsRef.current = 0
    setIsPolling(false)
  }, [])

  const start = useCallback(() => {
    stop()
    const sessionId = sessionIdRef.current
    let cancelled = false
    setIsPolling(true)

    const isCurrentSession = () =>
      !cancelled && sessionId === sessionIdRef.current && optionsRef.current.shouldContinue()

    const scheduleNext = (delayMs: number) => {
      if (!isCurrentSession()) return
      timerRef.current = window.setTimeout(() => {
        void pollOnce()
      }, delayMs)
    }

    const pollOnce = async () => {
      if (!isCurrentSession()) return
      if (inFlightRef.current) {
        scheduleNext(IN_FLIGHT_RESCHEDULE_MS)
        return
      }

      inFlightRef.current = true
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const keepPolling = await optionsRef.current.fetchFn(controller.signal)
        if (!isCurrentSession()) return
        consecutiveErrorsRef.current = 0
        if (keepPolling) {
          scheduleNext(optionsRef.current.intervalMs)
        } else {
          stop()
        }
      } catch {
        if (controller.signal.aborted || !isCurrentSession()) return
        consecutiveErrorsRef.current += 1
        if (consecutiveErrorsRef.current >= optionsRef.current.backoff.maxAttempts) {
          stop()
        } else {
          const delayMs = Math.min(
            optionsRef.current.backoff.baseMs * 2 ** (consecutiveErrorsRef.current - 1),
            optionsRef.current.backoff.maxMs,
          )
          scheduleNext(delayMs)
        }
      } finally {
        inFlightRef.current = false
        if (abortRef.current === controller) {
          abortRef.current = null
        }
      }
    }

    void pollOnce()

    return () => {
      cancelled = true
      if (sessionId === sessionIdRef.current) {
        stop()
      }
    }
  }, [stop])

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return { start, stop, isPolling }
}
