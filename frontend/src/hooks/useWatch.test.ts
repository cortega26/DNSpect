// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWatch, deleteWatch, getWatches } from '@/lib/api'
import type { WatchConfigPayload, WatchEntry, WatchListResponse } from '@/lib/types'

import { useWatch } from './useWatch'

vi.mock('@/lib/api', () => ({
  getWatches: vi.fn(),
  createWatch: vi.fn(),
  deleteWatch: vi.fn(),
}))

const mockGetWatches = vi.mocked(getWatches)
const mockCreateWatch = vi.mocked(createWatch)
const mockDeleteWatch = vi.mocked(deleteWatch)

function watchEntry(id: string): WatchEntry {
  return {
    watch_id: id,
    config: {
      target_snapshot: { resolver_ips: ['1.1.1.1'], selection_source: 'manual' },
      interval_min: 30,
    },
    runtime: {
      active_run_id: null,
      last_run_id: null,
      last_evaluated_at: null,
      last_alert_at: null,
      alert_events: [],
    },
  }
}

function listResponse(watches: WatchEntry[]): WatchListResponse {
  return { watches }
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

beforeEach(() => {
  mockGetWatches.mockReset()
  mockCreateWatch.mockReset()
  mockDeleteWatch.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('useWatch', () => {
  it('lists watches on mount', async () => {
    mockGetWatches.mockResolvedValue(listResponse([watchEntry('w1')]))

    const { result } = renderHook(() => useWatch())

    expect(mockGetWatches).toHaveBeenCalledTimes(1)
    expect(result.current.watchesLoading).toBe(true)
    await waitFor(() => expect(result.current.watches).toEqual([watchEntry('w1')]))
    expect(result.current.watchesLoading).toBe(false)
  })

  it('create calls api and refreshes the list', async () => {
    mockGetWatches.mockResolvedValue(listResponse([]))
    mockCreateWatch.mockResolvedValue({ watch_id: 'w2' })

    const { result } = renderHook(() => useWatch())
    await waitFor(() => expect(result.current.watches).toEqual([]))

    const payload: WatchConfigPayload = {
      target_snapshot: { resolver_ips: ['1.1.1.1'], selection_source: 'manual' },
      interval_min: 15,
    }
    await act(async () => {
      await result.current.create(payload)
    })

    expect(mockCreateWatch).toHaveBeenCalledWith(payload)
    expect(mockGetWatches).toHaveBeenCalledTimes(2)
    expect(result.current.watches).toEqual([])
  })

  it('remove calls api and refreshes the list', async () => {
    mockGetWatches.mockResolvedValue(listResponse([watchEntry('w1')]))
    mockDeleteWatch.mockResolvedValue(undefined)

    const { result } = renderHook(() => useWatch())
    await waitFor(() => expect(result.current.watches).toHaveLength(1))

    mockGetWatches.mockResolvedValue(listResponse([]))
    await act(async () => {
      await result.current.remove('w1')
    })

    expect(mockDeleteWatch).toHaveBeenCalledWith('w1')
    expect(mockGetWatches).toHaveBeenCalledTimes(2)
    expect(result.current.watches).toEqual([])
  })

  it('aborts the in-flight list on unmount', async () => {
    const pending = deferred<WatchListResponse>()
    let capturedSignal: AbortSignal | undefined
    mockGetWatches.mockImplementation((signal) => {
      capturedSignal = signal
      return pending.promise
    })

    const { unmount } = renderHook(() => useWatch())
    expect(capturedSignal).toBeDefined()

    unmount()
    expect(capturedSignal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(listResponse([watchEntry('late')]))
    })
    expect(mockGetWatches).toHaveBeenCalledTimes(1)
  })

  it('keeps refresh stable across renders', async () => {
    mockGetWatches.mockResolvedValue(listResponse([]))

    const { result, rerender } = renderHook(() => useWatch())
    const firstRefresh = result.current.refresh

    rerender()
    rerender()

    expect(result.current.refresh).toBe(firstRefresh)
    expect(mockGetWatches).toHaveBeenCalledTimes(1)
  })
})
