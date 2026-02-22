import type { ProbeResponse, ProbeResult, Sample } from './types'

export interface ProbeSummary {
  resolver: string
  providerName: string
  medianMs: number | null
  failureRate: number
  sampleCount: number
  successfulSamples: number
  latencyIqrMs: number | null
}

export type ProbeOutcome = 'better' | 'same' | 'worse' | 'inconclusive' | 'low_confidence'

export const PROBE_SCORE_BASE_DELTA_MS = 8
export const PROBE_LOW_CONFIDENCE_IQR_BASELINE_MS = 12
export const PROBE_LOW_CONFIDENCE_IQR_RATIO = 0.35

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function successfulLatencies(samples: Sample[] | undefined): number[] {
  return (samples ?? [])
    .filter((sample) => sample.ok && isFiniteNumber(sample.ms))
    .map((sample) => sample.ms as number)
}

function fallbackMedian(samples: Sample[] | undefined): number | null {
  return median(successfulLatencies(samples))
}

function fallbackFailureRate(samples: Sample[] | undefined): number {
  const list = samples ?? []
  if (list.length === 0) return 1
  const failures = list.filter((sample) => !sample.ok).length
  return failures / list.length
}

function quantile(sorted: number[], quantilePoint: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * quantilePoint
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return sorted[lowerIndex]
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]
  const weight = position - lowerIndex
  return lower + (upper - lower) * weight
}

function interquartileRange(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  return Math.max(0, q3 - q1)
}

export function summarizeProbeResult(result: ProbeResult): ProbeSummary {
  const latencies = successfulLatencies(result.samples)
  const medianMs = isFiniteNumber(result.stats?.median_ms) ? result.stats.median_ms : fallbackMedian(result.samples)
  const failureRate = isFiniteNumber(result.stats?.failure_rate)
    ? Math.max(0, Math.min(1, result.stats.failure_rate))
    : fallbackFailureRate(result.samples)
  const latencyIqrMs = interquartileRange(latencies)

  return {
    resolver: result.resolver,
    providerName: result.provider_name,
    medianMs,
    failureRate,
    sampleCount: result.samples?.length ?? 0,
    successfulSamples: latencies.length,
    latencyIqrMs,
  }
}

export function parseProbeResponse(payload: ProbeResponse): Map<string, ProbeSummary> {
  const byResolver = new Map<string, ProbeSummary>()
  ;(payload.results ?? []).forEach((result) => {
    byResolver.set(result.resolver, summarizeProbeResult(result))
  })
  return byResolver
}

function probeScore(summary: ProbeSummary | null): number | null {
  if (!summary) return null
  const latency = summary.medianMs ?? 1500
  return latency + summary.failureRate * 600
}

function lowConfidenceIqrThresholdMs(summary: ProbeSummary): number {
  const baselineMedian = summary.medianMs ?? 0
  return Math.max(PROBE_LOW_CONFIDENCE_IQR_BASELINE_MS, baselineMedian * PROBE_LOW_CONFIDENCE_IQR_RATIO)
}

function isLowConfidence(summary: ProbeSummary | null): boolean {
  if (!summary || summary.latencyIqrMs === null) return false
  return summary.latencyIqrMs > lowConfidenceIqrThresholdMs(summary)
}

function noiseEnvelopeMs(recommended: ProbeSummary, current: ProbeSummary): number {
  const recommendedIqr = recommended.latencyIqrMs ?? 0
  const currentIqr = current.latencyIqrMs ?? 0
  return Math.max(PROBE_SCORE_BASE_DELTA_MS, recommendedIqr, currentIqr)
}

export function compareProbeSummaries(recommended: ProbeSummary | null, current: ProbeSummary | null): ProbeOutcome {
  if (!recommended || !current) return 'inconclusive'
  const recommendedScore = probeScore(recommended)
  const currentScore = probeScore(current)

  if (recommendedScore === null || currentScore === null) return 'inconclusive'
  if (isLowConfidence(recommended) || isLowConfidence(current)) return 'low_confidence'

  const delta = currentScore - recommendedScore
  const threshold = noiseEnvelopeMs(recommended, current)
  if (delta >= threshold) return 'better'
  if (delta <= -threshold) return 'worse'
  return 'same'
}
