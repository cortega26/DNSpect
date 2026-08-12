// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getBenchmarkHistory, type RunHistoryEntry, type RunHistoryResponse } from '@/lib/api'

import { useRunHistory } from './useRunHistory'

vi.mock('@/lib/api', () => ({
  getBenchmarkHistory: vi.fn(),
}))

const mockGetBenchmarkHistory = vi.mocked(getBenchmarkHistory)

function runEntry(id: string): RunHistoryEntry {
  return {
    id,
    mode: 'quick',
    protocol: 'udp',
    started_at: '2026-01-01T00:00:00Z',
    finished_at: null,
    status: 'done',
    results_summary: [],
  }
}

function historyResponse(runs: RunHistoryEntry[]): RunHistoryResponse {
  return { runs }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderHistoryHook(initialSessionStatusId: string | null = null) {
  return renderHook(
    ({ sessionStatusId }: { sessionStatusId: string | null }) => useRunHistory(sessionStatusId),
    { initialProps: { sessionStatusId: initialSessionStatusId } },
  )
}

beforeEach(() => {
  mockGetBenchmarkHistory.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useRunHistory', () => {
  it('fetches history on mount', async () => {
    mockGetBenchmarkHistory.mockResolvedValue(historyResponse([runEntry('a')]))

    const { result } = renderHistoryHook()

    expect(mockGetBenchmarkHistory).toHaveBeenCalledTimes(1)
    expect(result.current.historyLoading).toBe(true)
    await waitFor(() => expect(result.current.history).toEqual([runEntry('a')]))
    expect(result.current.historyLoading).toBe(false)
  })

  it('refresh re-fetches history', async () => {
    mockGetBenchmarkHistory.mockResolvedValue(historyResponse([runEntry('a')]))

    const { result } = renderHistoryHook()
    await waitFor(() => expect(result.current.history).toEqual([runEntry('a')]))

    mockGetBenchmarkHistory.mockResolvedValue(historyResponse([runEntry('b')]))
    await act(async () => {
      await result.current.refresh()
    })

    expect(mockGetBenchmarkHistory).toHaveBeenCalledTimes(2)
    expect(result.current.history).toEqual([runEntry('b')])
  })

  it('drops a stale response after the session id changes', async () => {
    const first = deferred<RunHistoryResponse>()
    const second = deferred<RunHistoryResponse>()
    const signals: (AbortSignal | undefined)[] = []
    let call = 0
    mockGetBenchmarkHistory.mockImplementation((signal) => {
      signals.push(signal)
      call += 1
      return call === 1 ? first.promise : second.promise
    })

    const { result, rerender } = renderHistoryHook(null)

    act(() => {
      rerender({ sessionStatusId: 'run-b' })
    })
    expect(mockGetBenchmarkHistory).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      first.resolve(historyResponse([runEntry('stale')]))
    })
    expect(result.current.history).toEqual([])

    await act(async () => {
      second.resolve(historyResponse([runEntry('fresh')]))
    })
    expect(result.current.history).toEqual([runEntry('fresh')])
  })

  it('aborts the in-flight fetch on unmount', async () => {
    const pending = deferred<RunHistoryResponse>()
    let capturedSignal: AbortSignal | undefined
    mockGetBenchmarkHistory.mockImplementation((signal) => {
      capturedSignal = signal
      return pending.promise
    })

    const { unmount } = renderHistoryHook()
    expect(capturedSignal).toBeDefined()

    unmount()
    expect(capturedSignal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(historyResponse([runEntry('late')]))
    })
    expect(mockGetBenchmarkHistory).toHaveBeenCalledTimes(1)
  })

  it('keeps refresh stable across renders', async () => {
    mockGetBenchmarkHistory.mockResolvedValue(historyResponse([]))

    const { result, rerender } = renderHistoryHook(null)
    const firstRefresh = result.current.refresh

    act(() => {
      rerender({ sessionStatusId: 'a' })
    })
    act(() => {
      rerender({ sessionStatusId: 'b' })
    })

    expect(result.current.refresh).toBe(firstRefresh)
    expect(mockGetBenchmarkHistory).toHaveBeenCalledTimes(3)
  })
})
