// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/lib/i18n'
import type { RunComparisonResponse } from '@/lib/types'

import { RunComparisonPanel } from './RunComparisonPanel'

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nProvider, null, children)
}

function metrics(median: number) {
  return {
    median_ms: median,
    p95_ms: Number((median * 1.4).toFixed(2)),
    p99_ms: Number((median * 1.7).toFixed(2)),
    success_rate: 1,
    failure_rate: 0,
    blocking_efficacy: null,
    score_total: 0.9,
  }
}

function comparison(): RunComparisonResponse {
  return {
    baseline_id: 'baseline-1',
    candidate_id: 'candidate-1',
    baseline_manifest: null,
    candidate_manifest: null,
    comparable: true,
    reason_codes: [],
    missing_baseline_results: [],
    missing_candidate_results: [],
    rows: [
      {
        resolver: '1.1.1.1',
        baseline: metrics(12.3),
        candidate: metrics(15.2),
        baseline_rank: 1,
        candidate_rank: 2,
        deltas: { ...metrics(0), median_ms: 2.9, p95_ms: 4.06, p99_ms: 5.1, score_total: 0.04, rank: 1 },
      },
    ],
  }
}

function renderPanel() {
  return render(
    createElement(
      Wrapper,
      null,
      createElement(RunComparisonPanel, {
        baselineId: 'baseline-1',
        candidateId: 'candidate-1',
        comparison: comparison(),
        loading: false,
        error: null,
        onClear: () => {},
      }),
    ),
  )
}

afterEach(cleanup)

describe('RunComparisonPanel', () => {
  it('renders p99 alongside the other latency percentiles', () => {
    renderPanel()

    const row = screen.getByRole('row', { name: /p99/i })
    expect(row).toBeTruthy()
    // Baseline 20.91 ms, candidate 25.84 ms.
    expect(within(row).getByText('20.91 ms')).toBeTruthy()
    expect(within(row).getByText('25.84 ms')).toBeTruthy()
  })

  it('formats the p99 delta in milliseconds, not as a percentage', () => {
    renderPanel()

    const row = screen.getByRole('row', { name: /p99/i })
    // The value and its tone marker are separate nodes, so match on the row text.
    const text = row.textContent ?? ''
    expect(text).toContain('+5.10 ms')
    // A latency delta of +5.10 ms must never be rendered as "+510.0%".
    expect(text).not.toContain('510.0%')
  })

  it('marks a p99 regression as an improvement in the wrong direction', () => {
    // Higher p99 is worse, so a positive delta must read as a regression.
    renderPanel()

    const row = screen.getByRole('row', { name: /p99/i })
    expect(row.textContent).toMatch(/\+5\.10 ms\s*✗/)
  })
})
