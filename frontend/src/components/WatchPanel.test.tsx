// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWatch, type WatchState } from '@/hooks/useWatch'
import { I18nProvider } from '@/lib/i18n'
import type { WatchEntry } from '@/lib/types'

import { WatchPanel, type WatchSessionConfig } from './WatchPanel'

vi.mock('@/hooks/useWatch', () => ({
  useWatch: vi.fn(),
}))

const mockUseWatch = vi.mocked(useWatch)

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nProvider, null, children)
}

function watchEntry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    watch_id: 'w1',
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
    ...overrides,
  }
}

function baseState(overrides: Partial<WatchState> = {}): WatchState {
  return {
    watches: [],
    watchesLoading: false,
    watchesError: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const session: WatchSessionConfig = {
  target_snapshot: { resolver_ips: ['1.1.1.1'], selection_source: 'manual' },
  protocol: 'udp',
  scoring_profile: 'speed',
  mode: 'standard',
  runs: 30,
  timeout_sec: 2,
}

function renderPanel(state: WatchState, props: Partial<Parameters<typeof WatchPanel>[0]> = {}) {
  mockUseWatch.mockReturnValue(state)
  return render(
    <WatchPanel
      doqAvailable
      running={false}
      currentSession={session}
      onCompare={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  mockUseWatch.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WatchPanel', () => {
  it('renders empty state when no watches', () => {
    renderPanel(baseState())

    expect(screen.getByText('No watches configured yet.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders error state instead of empty when fetch failed', () => {
    renderPanel(baseState({ watchesError: 'boom' }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not load watches')
    expect(screen.queryByText('No watches configured yet.')).toBeNull()
  })

  it('renders watch rows with status pill and alert count', () => {
    const entry = watchEntry({
      config: { target_snapshot: { resolver_ips: ['1.1.1.1'], selection_source: 'manual' }, protocol: 'udp', mode: 'standard', interval_min: 15 },
      runtime: {
        active_run_id: null,
        last_run_id: 'run-1',
        last_evaluated_at: null,
        last_alert_at: null,
        alert_events: [{ type: 'threshold_alert', metric: 'median_ms', baseline_id: 'b', run_id: 'r' }],
      },
    })
    renderPanel(baseState({ watches: [entry] }))

    expect(screen.getByText('Evaluating')).toBeTruthy()
    expect(screen.getByText('Alerts: 1')).toBeTruthy()
    expect(screen.getByText('Delete watch')).toBeTruthy()
  })

  it('alert banner renders threshold events and calls onCompare with baseline and run ids', () => {
    const onCompare = vi.fn()
    const entry = watchEntry({
      runtime: {
        active_run_id: null,
        last_run_id: 'run-1',
        last_evaluated_at: '2026-08-11T00:00:00Z',
        last_alert_at: '2026-08-11T00:00:00Z',
        alert_events: [
          {
            type: 'threshold_alert',
            baseline_id: 'baseline-1',
            run_id: 'run-1',
            resolver: '1.1.1.1',
            metric: 'success_rate',
            baseline_value: 0.99,
            candidate_value: 0.93,
            delta: 0.06,
            threshold: 5.0,
          },
        ],
      },
    })
    const { container } = renderPanel(baseState({ watches: [entry] }), { onCompare })

    const banner = container.querySelector('.watch-alert-banner')
    expect(banner).toBeTruthy()
    expect(banner?.textContent).toContain('success_rate')
    expect(banner?.textContent).toContain('99.0% → 93.0% (6.0%)')

    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }))
    expect(onCompare).toHaveBeenCalledWith('baseline-1', 'run-1')
  })

  it('delete calls onRemove after confirm', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    renderPanel(baseState({ watches: [watchEntry()], remove }))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(screen.getByRole('button', { name: 'Delete watch' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('w1'))
    expect(confirmSpy).toHaveBeenCalledTimes(1)

    confirmSpy.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete watch' }))
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  })

  it('create button disabled while a benchmark runs', () => {
    renderPanel(baseState(), { running: true })

    const createButton = screen.getByRole('button', {
      name: 'Create watch from current configuration',
    }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)
  })
})
