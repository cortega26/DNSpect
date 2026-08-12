// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSystemDns, probeResolvers } from '@/lib/api'
import { I18nProvider } from '@/lib/i18n'
import { compareProbeSummaries, parseProbeResponse, type ProbeSummary } from '@/lib/probe'
import type { ProbeResponse, SystemDnsPayload } from '@/lib/types'

import { useGuidedVerification } from './useGuidedVerification'

vi.mock('@/lib/api', () => ({
  getSystemDns: vi.fn(),
  probeResolvers: vi.fn(),
}))

vi.mock('@/lib/probe', () => ({
  parseProbeResponse: vi.fn(),
  compareProbeSummaries: vi.fn(),
}))

const mockGetSystemDns = vi.mocked(getSystemDns)
const mockProbeResolvers = vi.mocked(probeResolvers)
const mockParseProbeResponse = vi.mocked(parseProbeResponse)
const mockCompareProbeSummaries = vi.mocked(compareProbeSummaries)

const SYSTEM_DNS: SystemDnsPayload = {
  resolvers: ['1.1.1.1'],
  method: 'auto',
  platform: 'linux',
  detected_provider_id: 'cloudflare',
}

const PROBE_PAYLOAD: ProbeResponse = {
  engine: 'dnspython',
  timeout_sec: 1.5,
  runs_per_resolver: 4,
  queried_at: '2026-01-01T00:00:00Z',
  results: [],
}

function summary(resolver: string): ProbeSummary {
  return {
    resolver,
    providerName: 'provider',
    medianMs: 10,
    failureRate: 0,
    sampleCount: 4,
    successfulSamples: 4,
    latencyIqrMs: 2,
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
  mockGetSystemDns.mockReset()
  mockProbeResolvers.mockReset()
  mockParseProbeResponse.mockReset()
  mockCompareProbeSummaries.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useGuidedVerification', () => {
  it('verify refreshes system DNS and probes the merged resolver set', async () => {
    mockGetSystemDns.mockResolvedValue(SYSTEM_DNS)
    mockProbeResolvers.mockResolvedValue(PROBE_PAYLOAD)
    const recommended = summary('9.9.9.9')
    const current = summary('1.1.1.1')
    mockParseProbeResponse.mockReturnValue(
      new Map([
        ['9.9.9.9', recommended],
        ['1.1.1.1', current],
      ]),
    )
    mockCompareProbeSummaries.mockReturnValue('better')
    const onSystemDnsRefreshed = vi.fn()

    const { result } = renderHook(() => useGuidedVerification(onSystemDnsRefreshed), { wrapper: Wrapper })

    await act(async () => {
      await result.current.verify({ recommendedResolver: '9.9.9.9', systemDns: null })
    })

    expect(mockGetSystemDns).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(onSystemDnsRefreshed).toHaveBeenCalledWith(SYSTEM_DNS)
    expect(mockProbeResolvers).toHaveBeenCalledWith(
      { resolvers: ['9.9.9.9', '1.1.1.1'], runs_per_resolver: 4, timeout_sec: 1.5 },
      expect.any(AbortSignal),
    )
    expect(mockParseProbeResponse).toHaveBeenCalledWith(PROBE_PAYLOAD)
    expect(mockCompareProbeSummaries).toHaveBeenCalledWith(recommended, current)
    expect(result.current.verification).toEqual({
      outcome: 'better',
      recommended,
      current,
      currentResolver: '1.1.1.1',
      sampleSize: 4,
    })
    expect(result.current.isVerifying).toBe(false)
    expect(result.current.verifyError).toBeNull()
  })

  it('keeps the provided system DNS when the refresh fails', async () => {
    mockGetSystemDns.mockRejectedValue(new Error('dns refresh failed'))
    mockProbeResolvers.mockResolvedValue(PROBE_PAYLOAD)
    mockParseProbeResponse.mockReturnValue(new Map())
    mockCompareProbeSummaries.mockReturnValue('inconclusive')
    const onSystemDnsRefreshed = vi.fn()

    const { result } = renderHook(() => useGuidedVerification(onSystemDnsRefreshed), { wrapper: Wrapper })

    await act(async () => {
      await result.current.verify({ recommendedResolver: '9.9.9.9', systemDns: SYSTEM_DNS })
    })

    expect(mockProbeResolvers).toHaveBeenCalledWith(
      { resolvers: ['9.9.9.9', '1.1.1.1'], runs_per_resolver: 4, timeout_sec: 1.5 },
      expect.any(AbortSignal),
    )
    expect(onSystemDnsRefreshed).not.toHaveBeenCalled()
    expect(result.current.isVerifying).toBe(false)
  })

  it('cancel aborts the in-flight probe and discards its result', async () => {
    mockGetSystemDns.mockResolvedValue(SYSTEM_DNS)
    const pendingProbe = deferred<ProbeResponse>()
    let capturedSignal: AbortSignal | undefined
    mockProbeResolvers.mockImplementation((_payload, signal) => {
      capturedSignal = signal
      return pendingProbe.promise
    })
    const onSystemDnsRefreshed = vi.fn()

    const { result } = renderHook(() => useGuidedVerification(onSystemDnsRefreshed), { wrapper: Wrapper })

    let verifyPromise!: Promise<void>
    await act(async () => {
      verifyPromise = result.current.verify({ recommendedResolver: '9.9.9.9', systemDns: null })
    })
    expect(result.current.isVerifying).toBe(true)

    await act(async () => {
      result.current.cancel()
    })
    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(result.current.verification).toBeNull()

    await act(async () => {
      pendingProbe.resolve(PROBE_PAYLOAD)
    })
    await act(async () => {
      await verifyPromise
    })
    expect(mockParseProbeResponse).not.toHaveBeenCalled()
    expect(result.current.verification).toBeNull()
  })

  it('drops stale verify results from an earlier request', async () => {
    mockGetSystemDns.mockResolvedValue(SYSTEM_DNS)
    const first = deferred<ProbeResponse>()
    const second = deferred<ProbeResponse>()
    const freshPayload: ProbeResponse = { ...PROBE_PAYLOAD, engine: 'fresh-engine' }
    const signals: (AbortSignal | undefined)[] = []
    mockProbeResolvers
      .mockImplementationOnce((_payload, signal) => {
        signals.push(signal)
        return first.promise
      })
      .mockImplementationOnce((_payload, signal) => {
        signals.push(signal)
        return second.promise
      })
    const firstSummary = summary('9.9.9.9')
    const staleSummary = { ...firstSummary, medianMs: 5 }
    mockParseProbeResponse.mockImplementation(
      (payload) => new Map([['9.9.9.9', payload === freshPayload ? firstSummary : staleSummary]]),
    )
    mockCompareProbeSummaries.mockReturnValue('better')
    const onSystemDnsRefreshed = vi.fn()

    const { result } = renderHook(() => useGuidedVerification(onSystemDnsRefreshed), { wrapper: Wrapper })

    let firstVerify!: Promise<void>
    let secondVerify!: Promise<void>
    await act(async () => {
      firstVerify = result.current.verify({ recommendedResolver: '9.9.9.9', systemDns: null })
    })
    await act(async () => {
      secondVerify = result.current.verify({ recommendedResolver: '9.9.9.9', systemDns: null })
    })
    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      first.resolve(PROBE_PAYLOAD)
    })
    expect(result.current.verification).toBeNull()

    await act(async () => {
      second.resolve(freshPayload)
    })
    await act(async () => {
      await Promise.all([firstVerify, secondVerify])
    })
    expect(mockParseProbeResponse).toHaveBeenCalledTimes(1)
    expect(mockParseProbeResponse).toHaveBeenCalledWith(freshPayload)
    expect(result.current.verification?.outcome).toBe('better')
    expect(result.current.verification?.recommended).toEqual(firstSummary)
    expect(result.current.isVerifying).toBe(false)
  })
})
