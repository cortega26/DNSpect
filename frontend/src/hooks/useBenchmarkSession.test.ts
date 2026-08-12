// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getBenchmark, startBenchmark } from '@/lib/api'
import { I18nProvider } from '@/lib/i18n'
import type { BenchmarkStatus } from '@/lib/types'

import { useBenchmarkSession, type BenchmarkStartPayload } from './useBenchmarkSession'

vi.mock('@/lib/api', () => ({
  getBenchmark: vi.fn(),
  startBenchmark: vi.fn(),
}))

const mockGetBenchmark = vi.mocked(getBenchmark)
const mockStartBenchmark = vi.mocked(startBenchmark)

const PAYLOAD: BenchmarkStartPayload = {
  mode: 'standard',
  timeout_sec: 2,
  resolvers: ['1.1.1.1'],
}

function benchmarkStatus(id: string, status: BenchmarkStatus['status']): BenchmarkStatus {
  return {
    id,
    status,
    progress: { current: 0, total: 1, current_resolver: null },
    started_at: '2026-01-01T00:00:00Z',
    finished_at: null,
    mode: 'standard',
    protocol: 'udp',
    timeout_sec: 2,
    runs: 1,
    engine: null,
    error: null,
    results: null,
  }
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

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nProvider, null, children)
}

beforeEach(() => {
  mockGetBenchmark.mockReset()
  mockStartBenchmark.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useBenchmarkSession', () => {
  it('starts polling until the run reaches a terminal status', async () => {
    vi.useFakeTimers()
    mockStartBenchmark.mockResolvedValue({ benchmark_id: 'b1' })
    mockGetBenchmark
      .mockResolvedValueOnce(benchmarkStatus('b1', 'running'))
      .mockResolvedValueOnce(benchmarkStatus('b1', 'done'))

    const { result } = renderHook(() => useBenchmarkSession(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)

    await act(async () => {})
    expect(result.current.status?.status).toBe('running')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(2)
    expect(result.current.status?.status).toBe('done')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale poll response from a previous session', async () => {
    vi.useFakeTimers()
    mockStartBenchmark
      .mockResolvedValueOnce({ benchmark_id: 'b1' })
      .mockResolvedValueOnce({ benchmark_id: 'b2' })
    const first = deferred<BenchmarkStatus>()
    const second = deferred<BenchmarkStatus>()
    const signals: (AbortSignal | undefined)[] = []
    let call = 0
    mockGetBenchmark.mockImplementation((_id, _includeSamples, signal) => {
      signals.push(signal)
      call += 1
      return call === 1 ? first.promise : second.promise
    })

    const { result } = renderHook(() => useBenchmarkSession(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)
    expect(signals[0]?.aborted).toBe(false)

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      first.resolve(benchmarkStatus('b1', 'done'))
    })
    expect(result.current.status).toBeNull()

    await act(async () => {
      second.resolve(benchmarkStatus('b2', 'done'))
    })
    expect(result.current.status?.id).toBe('b2')
    expect(result.current.status?.status).toBe('done')
  })

  it('stops polling and aborts on unmount', async () => {
    vi.useFakeTimers()
    mockStartBenchmark.mockResolvedValue({ benchmark_id: 'b1' })
    const pending = deferred<BenchmarkStatus>()
    let capturedSignal: AbortSignal | undefined
    mockGetBenchmark.mockImplementation((_id, _includeSamples, signal) => {
      capturedSignal = signal
      return pending.promise
    })

    const { result, unmount } = renderHook(() => useBenchmarkSession(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)

    unmount()
    expect(capturedSignal?.aborted).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(benchmarkStatus('b1', 'done'))
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)
  })

  it('retries transient poll errors with backoff and then succeeds', async () => {
    vi.useFakeTimers()
    mockStartBenchmark.mockResolvedValue({ benchmark_id: 'b1' })
    mockGetBenchmark
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValueOnce(benchmarkStatus('b1', 'done'))

    const { result } = renderHook(() => useBenchmarkSession(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    await act(async () => {})
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBe('boom 2')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(3)
    expect(result.current.status?.status).toBe('done')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(3)
  })

  it('stops polling after 5 consecutive errors', async () => {
    vi.useFakeTimers()
    mockStartBenchmark.mockResolvedValue({ benchmark_id: 'b1' })
    mockGetBenchmark.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useBenchmarkSession(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    await act(async () => {})
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)

    for (const delay of [1000, 2000, 4000, 8000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
      })
    }

    expect(mockGetBenchmark).toHaveBeenCalledTimes(5)
    expect(result.current.error).toBe('boom')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(5)
  })

  it('serializes overlapping polls to one in-flight request', async () => {
    vi.useFakeTimers()
    mockStartBenchmark.mockResolvedValue({ benchmark_id: 'b1' })
    const pending = deferred<BenchmarkStatus>()
    mockGetBenchmark
      .mockImplementationOnce(() => pending.promise)
      .mockImplementation(() => Promise.resolve(benchmarkStatus('b1', 'running')))

    const { result } = renderHook(() => useBenchmarkSession(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(benchmarkStatus('b1', 'running'))
    })
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(2)
    expect(result.current.status?.status).toBe('running')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mockGetBenchmark).toHaveBeenCalledTimes(3)
  })
})
