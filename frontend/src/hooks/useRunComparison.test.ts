// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compareRuns } from '@/lib/api'
import { I18nProvider } from '@/lib/i18n'
import type { RunComparisonResponse } from '@/lib/types'

import { useRunComparison } from './useRunComparison'

vi.mock('@/lib/api', () => ({
  compareRuns: vi.fn(),
}))

const mockCompareRuns = vi.mocked(compareRuns)

function comparisonResponse(baselineId: string, candidateId: string): RunComparisonResponse {
  return {
    baseline_id: baselineId,
    candidate_id: candidateId,
    baseline_manifest: null,
    candidate_manifest: null,
    comparable: true,
    reason_codes: [],
    rows: [],
    missing_baseline_results: [],
    missing_candidate_results: [],
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
  mockCompareRuns.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useRunComparison', () => {
  it('selectPair fetches the comparison', async () => {
    const comparison = comparisonResponse('a', 'b')
    mockCompareRuns.mockResolvedValue(comparison)

    const { result } = renderHook(() => useRunComparison(), { wrapper: Wrapper })

    await act(async () => {
      result.current.selectPair('a', 'b')
    })

    expect(mockCompareRuns).toHaveBeenCalledTimes(1)
    expect(mockCompareRuns).toHaveBeenCalledWith('a', 'b', expect.any(AbortSignal))
    await waitFor(() => expect(result.current.comparison).toBe(comparison))
    expect(result.current.baselineId).toBe('a')
    expect(result.current.candidateId).toBe('b')
    expect(result.current.comparisonLoading).toBe(false)
  })

  it('selectPair with nulls aborts the in-flight request and resets', async () => {
    const pending = deferred<RunComparisonResponse>()
    let capturedSignal: AbortSignal | undefined
    mockCompareRuns.mockImplementation((_baselineId, _candidateId, signal) => {
      capturedSignal = signal
      return pending.promise
    })

    const { result } = renderHook(() => useRunComparison(), { wrapper: Wrapper })

    await act(async () => {
      result.current.selectPair('a', 'b')
    })
    expect(result.current.comparisonLoading).toBe(true)

    await act(async () => {
      result.current.selectPair(null, null)
    })

    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.baselineId).toBeNull()
    expect(result.current.candidateId).toBeNull()
    expect(result.current.comparison).toBeNull()
    expect(result.current.comparisonLoading).toBe(false)
    expect(result.current.comparisonError).toBeNull()
  })

  it('clear aborts the in-flight request and resets', async () => {
    const pending = deferred<RunComparisonResponse>()
    let capturedSignal: AbortSignal | undefined
    mockCompareRuns.mockImplementation((_baselineId, _candidateId, signal) => {
      capturedSignal = signal
      return pending.promise
    })

    const { result } = renderHook(() => useRunComparison(), { wrapper: Wrapper })

    await act(async () => {
      result.current.selectPair('a', 'b')
    })

    await act(async () => {
      result.current.clear()
    })

    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.comparison).toBeNull()
    expect(result.current.comparisonLoading).toBe(false)
  })

  it('drops out-of-order comparison responses', async () => {
    const first = deferred<RunComparisonResponse>()
    const second = deferred<RunComparisonResponse>()
    const signals: (AbortSignal | undefined)[] = []
    mockCompareRuns
      .mockImplementationOnce((_b, _c, signal) => {
        signals.push(signal)
        return first.promise
      })
      .mockImplementationOnce((_b, _c, signal) => {
        signals.push(signal)
        return second.promise
      })

    const { result } = renderHook(() => useRunComparison(), { wrapper: Wrapper })

    await act(async () => {
      result.current.selectPair('a', 'b')
    })
    await act(async () => {
      result.current.selectPair('c', 'd')
    })
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      first.resolve(comparisonResponse('a', 'b'))
    })
    expect(result.current.comparison).toBeNull()

    await act(async () => {
      second.resolve(comparisonResponse('c', 'd'))
    })
    expect(result.current.comparison?.baseline_id).toBe('c')
    expect(result.current.comparison?.candidate_id).toBe('d')
    expect(result.current.comparisonLoading).toBe(false)
  })
})
