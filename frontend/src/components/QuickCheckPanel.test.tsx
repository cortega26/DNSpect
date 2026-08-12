// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/lib/i18n'
import type { BenchmarkStatus, ResolverResult, SystemDnsPayload } from '@/lib/types'

import { QuickCheckPanel } from './QuickCheckPanel'

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nProvider, null, children)
}

const SYSTEM_DNS: SystemDnsPayload = {
  resolvers: ['192.168.1.1'],
  method: 'test',
  platform: 'Linux (Test)',
  error_detail: null,
  detected_provider_id: 'isp-detectado',
}

function result(resolver: string, providerName: string, medianMs: number, failureRate = 0, scoreTotal = 0.97): ResolverResult {
  return {
    resolver,
    provider_id: resolver === '1.1.1.1' ? 'cloudflare' : 'quad9',
    provider_name: providerName,
    engine: 'drill',
    protocol: 'udp',
    stats: {
      avg_ms: medianMs,
      median_ms: medianMs,
      p95_ms: medianMs * 1.4,
      min_ms: medianMs * 0.7,
      max_ms: medianMs * 1.8,
      ok_count: 30,
      timeout_count: 0,
      success_rate: 1 - failureRate,
      timeout_rate: 0,
      success_count: 30,
      failure_count: Math.round(failureRate * 30),
      failure_rate: failureRate,
      consistency_ratio: 0.9,
      p95_minus_median_ms: medianMs * 0.4,
      score_latency: medianMs,
      score_reliability: 1 - failureRate,
      score_stability: 0.9,
      score_total: scoreTotal,
      normalized_latency: 0.9,
      normalized_reliability: 1 - failureRate,
      normalized_stability: 0.9,
      reliability_penalty: 0,
      max_rel_penalty: 0,
      blocking_efficacy: null,
      blocked_count: 0,
      blocking_test_count: 0,
      score_blocking: null,
      normalized_blocking: null,
      nxdomain_hijack_detected: null,
      dnssec_validating: null,
    },
    samples: [],
    sample_count: 30,
    is_unreliable: false,
  }
}

function doneStatus(recommended: ResolverResult, extra: ResolverResult[] = []): BenchmarkStatus {
  return {
    id: 'cafebabe00000000000000000000000001',
    status: 'done',
    progress: { current: 30, total: 30, current_resolver: null, last_sample_at: 0, avg_latency_ms: 15 },
    started_at: '2026-08-12T00:00:00Z',
    finished_at: '2026-08-12T00:00:05Z',
    mode: 'quick',
    goal: 'speed',
    scoring_profile: 'speed',
    protocol: 'udp',
    timeout_sec: 2,
    runs: 12,
    engine: 'drill',
    error: null,
    run_storage_warning: null,
    results: [recommended, ...extra],
    recommended_resolver: recommended.resolver,
    recommendation_warning: null,
    target_snapshot: { resolver_ips: [recommended.resolver], selection_source: 'catalog', provider_ids: null },
  }
}

const CLOUDFLARE = result('1.1.1.1', 'Cloudflare', 12.3)
const SYSTEM_RESULT = result('192.168.1.1', 'ISP (Detectado)', 42.0, 0.05, 0.84)

function renderPanel(props: Partial<Parameters<typeof QuickCheckPanel>[0]> = {}) {
  return render(
    <QuickCheckPanel
      status={null}
      error={null}
      systemDns={SYSTEM_DNS}
      resolverCount={7}
      onStart={vi.fn()}
      onApply={vi.fn()}
      onOpenLab={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper },
  )
}

describe('QuickCheckPanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('idle renders the intro and the single primary action', () => {
    renderPanel()

    expect(screen.getByText('One check. Verdict in seconds.')).toBeTruthy()
    const checkButton = screen.getByRole('button', { name: 'Check my DNS' }) as HTMLButtonElement
    expect(checkButton.disabled).toBe(false)
    expect(screen.queryByText(/Measuring/)).toBeNull()
    expect(screen.queryByText(/Verdict —/)).toBeNull()
  })

  it('running renders the measuring line and disables the check button', () => {
    renderPanel({ status: { ...doneStatus(CLOUDFLARE), status: 'running' } })

    const checkButton = screen.getByRole('button', { name: 'Check my DNS' }) as HTMLButtonElement
    expect(checkButton.disabled).toBe(true)
    expect(screen.getByText('Measuring 7 resolvers…')).toBeTruthy()
  })

  it('done renders the verdict card with numbers row and both actions', () => {
    const onApply = vi.fn()
    const onOpenLab = vi.fn()
    renderPanel({ status: doneStatus(CLOUDFLARE, [SYSTEM_RESULT]), onApply, onOpenLab })

    expect(screen.getByText('Verdict — cafebabe')).toBeTruthy()
    expect(screen.getByText('Switch to Cloudflare — ~71% faster median')).toBeTruthy()
    expect(screen.getByText('12.30 ms median — 29.70 ms faster than your current DNS')).toBeTruthy()
    expect(screen.getByText('0 failures in 30 queries')).toBeTruthy()
    expect(screen.getByText('90.0% stability across 12 runs')).toBeTruthy()

    expect(screen.getByText('12.30 ms')).toBeTruthy()
    expect(screen.getByText('17.22 ms')).toBeTruthy()
    expect(screen.getByText('0.0%')).toBeTruthy()
    expect(screen.getByText('97 / 100')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open in Lab' }))
    expect(onOpenLab).toHaveBeenCalledTimes(1)
  })

  it('a recommended resolver that is the system DNS renders the keep-it verdict', () => {
    renderPanel({ status: doneStatus(SYSTEM_RESULT, [CLOUDFLARE]) })

    expect(screen.getByText('Your DNS is good — keep it')).toBeTruthy()
    expect(screen.getByText('42.00 ms median — faster than 1 of 2 resolvers')).toBeTruthy()
    expect(screen.queryByText(/Switch to/)).toBeNull()
  })

  it('failed renders the instrument error state with retry', () => {
    const onStart = vi.fn()
    renderPanel({
      status: { ...doneStatus(CLOUDFLARE), status: 'failed', error: 'boom' },
      onStart,
    })

    expect(screen.getByText('The check could not be completed')).toBeTruthy()
    expect(screen.getByText('boom')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('done without a recommendation shows the no-verdict state with retry', () => {
    const onStart = vi.fn()
    renderPanel({
      status: { ...doneStatus(CLOUDFLARE), results: [], recommended_resolver: null },
      onStart,
    })

    expect(screen.getByText('No ranking data')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})
