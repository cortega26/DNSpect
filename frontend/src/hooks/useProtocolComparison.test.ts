// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getProtocolComparison, preflightProtocolComparison, startProtocolComparison } from '@/lib/api'
import { I18nProvider } from '@/lib/i18n'
import type {
  ProtocolComparisonPreflight,
  ProtocolComparisonStartPayload,
  ProtocolComparisonStatus,
} from '@/lib/types'

import { useProtocolComparison } from './useProtocolComparison'

vi.mock('@/lib/api', () => ({
  getProtocolComparison: vi.fn(),
  preflightProtocolComparison: vi.fn(),
  startProtocolComparison: vi.fn(),
}))

const mockGetProtocolComparison = vi.mocked(getProtocolComparison)
const mockPreflightProtocolComparison = vi.mocked(preflightProtocolComparison)
const mockStartProtocolComparison = vi.mocked(startProtocolComparison)

const PAYLOAD: ProtocolComparisonStartPayload = {
  protocols: ['udp', 'dot'],
  target_snapshot: { resolver_ips: ['1.1.1.1'], selection_source: 'manual' },
  scoring_profile: 'speed',
  mode: 'quick',
  timeout_sec: 2,
}

function preflightResult(admissible: boolean): ProtocolComparisonPreflight {
  return {
    canonical_protocols: ['udp', 'dot'],
    requested_target_snapshot: PAYLOAD.target_snapshot,
    common_eligible_target_snapshot: PAYLOAD.target_snapshot,
    exclusions: [],
    endpoint_identities: [],
    normal_query_plan_sha256: 'abc',
    normal_query_count: 8,
    blocking_query_plan_sha256: 'def',
    blocking_query_count: 2,
    effective_runs: 1,
    timeout_sec: 2,
    total_attempts: 10,
    estimated_duration_sec: 5,
    admissible,
    admission_reason_codes: [],
  }
}

function protocolStatus(id: string, status: ProtocolComparisonStatus['status']): ProtocolComparisonStatus {
  return {
    comparison_id: id,
    status,
    complete: status === 'done' || status === 'failed',
    error: null,
    run_storage_warning: null,
    progress: {
      current: 0,
      total: 1,
      current_protocol: null,
      current_resolver: null,
      last_sample_at: null,
      avg_latency_ms: null,
    },
    exclusions: [],
    subruns: [],
    delta_pairs: [],
  } as unknown as ProtocolComparisonStatus
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
  mockGetProtocolComparison.mockReset()
  mockPreflightProtocolComparison.mockReset()
  mockStartProtocolComparison.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useProtocolComparison', () => {
  it('fires the preflight on every payload change', async () => {
    const admissible = preflightResult(true)
    mockPreflightProtocolComparison.mockResolvedValue(admissible)

    const { result } = renderHook(() => useProtocolComparison(), { wrapper: Wrapper })

    await act(async () => {
      result.current.runPreflight(PAYLOAD)
    })
    expect(mockPreflightProtocolComparison).toHaveBeenCalledTimes(1)
    expect(mockPreflightProtocolComparison).toHaveBeenCalledWith(PAYLOAD, expect.any(AbortSignal))
    await waitFor(() => expect(result.current.preflight).toBe(admissible))
    expect(result.current.preflightLoading).toBe(false)

    const secondPayload: ProtocolComparisonStartPayload = { ...PAYLOAD, protocols: ['udp', 'dot', 'doh'] }
    await act(async () => {
      result.current.runPreflight(secondPayload)
    })
    expect(mockPreflightProtocolComparison).toHaveBeenCalledTimes(2)
    expect(mockPreflightProtocolComparison).toHaveBeenLastCalledWith(secondPayload, expect.any(AbortSignal))
  })

  it('aborts the previous preflight when a new payload arrives', async () => {
    const pending = deferred<ProtocolComparisonPreflight>()
    const signals: (AbortSignal | undefined)[] = []
    mockPreflightProtocolComparison
      .mockImplementationOnce((_payload, signal) => {
        signals.push(signal)
        return pending.promise
      })
      .mockResolvedValueOnce(preflightResult(true))

    const { result } = renderHook(() => useProtocolComparison(), { wrapper: Wrapper })

    await act(async () => {
      result.current.runPreflight(PAYLOAD)
    })
    expect(mockPreflightProtocolComparison).toHaveBeenCalledTimes(1)
    expect(signals[0]?.aborted).toBe(false)

    await act(async () => {
      result.current.runPreflight({ ...PAYLOAD, protocols: ['dot', 'doh'] })
    })
    expect(mockPreflightProtocolComparison).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(preflightResult(false))
    })
    await act(async () => {})
    await waitFor(() => expect(result.current.preflight?.admissible).toBe(true))
  })

  it('retries transient poll errors with backoff and then succeeds', async () => {
    vi.useFakeTimers()
    mockStartProtocolComparison.mockResolvedValue({ comparison_id: 'c1' })
    mockGetProtocolComparison
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValueOnce(protocolStatus('c1', 'done'))

    const { result } = renderHook(() => useProtocolComparison(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    expect(result.current.comparisonId).toBe('c1')
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(1)

    await act(async () => {})
    expect(result.current.comparisonError).toBe('boom 1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(2)
    expect(result.current.comparisonError).toBe('boom 2')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(3)
    expect(result.current.comparison?.status).toBe('done')
    expect(result.current.comparisonLoading).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(3)
  })

  it('stops polling after 5 consecutive errors', async () => {
    vi.useFakeTimers()
    mockStartProtocolComparison.mockResolvedValue({ comparison_id: 'c1' })
    mockGetProtocolComparison.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useProtocolComparison(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    await act(async () => {})
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(1)

    for (const delay of [1000, 2000, 4000, 8000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
      })
    }

    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(5)
    expect(result.current.comparisonError).toBe('boom')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(5)
  })

  it('transient poll error clears and backoff resets on recovery', async () => {
    vi.useFakeTimers()
    mockStartProtocolComparison.mockResolvedValue({ comparison_id: 'c1' })
    mockGetProtocolComparison
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValueOnce(protocolStatus('c1', 'running'))

    const { result } = renderHook(() => useProtocolComparison(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    await act(async () => {})
    expect(result.current.comparisonError).toBe('transient 1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.comparisonError).toBe('transient 2')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(3)
    expect(result.current.comparison?.status).toBe('running')
    expect(result.current.comparisonError).toBeNull()

    mockStartProtocolComparison.mockResolvedValue({ comparison_id: 'c2' })
    mockGetProtocolComparison.mockRejectedValueOnce(new Error('new session boom'))
    await act(async () => {
      await result.current.start(PAYLOAD)
    })
    await act(async () => {})
    expect(result.current.comparisonId).toBe('c2')
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(4)
    expect(result.current.comparisonError).toBe('new session boom')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mockGetProtocolComparison).toHaveBeenCalledTimes(5)
  })
})
