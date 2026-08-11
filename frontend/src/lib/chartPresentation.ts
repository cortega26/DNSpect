export type ChartMetricKind = 'median' | 'p95' | 'reliability' | 'blocking'

export type FavorableDirection = 'lower-is-better' | 'higher-is-better'

export interface ChartMetricSpec {
  kind: ChartMetricKind
  favorableDirection: FavorableDirection
  sortDirection: 'asc' | 'desc'
  yAxisDomain: [number | 'auto', number | 'auto']
  yAxisUnit: string
  extractValue: (successRate: number | null, blockingEfficacy: number | null) => number | null
}

const MIDDLE = 'var(--neutral)'

export function colorForValue(
  value: number | null,
  sortedValues: number[],
  favorableDirection: FavorableDirection,
): string {
  if (value === null || sortedValues.length < 3) return 'var(--accent)'
  const lowIdx = Math.floor(sortedValues.length / 3)
  const highIdx = Math.floor((sortedValues.length * 2) / 3)
  const lowThresh = sortedValues[lowIdx]
  const highThresh = sortedValues[highIdx]

  const isLowest = value <= lowThresh
  const isMiddle = value <= highThresh
  const isHigh = !isLowest && !isMiddle

  if (favorableDirection === 'lower-is-better') {
    if (isLowest) return 'var(--success)'
    if (isMiddle) return 'var(--warning)'
    if (isHigh) return 'var(--danger)'
    return MIDDLE
  }

  if (favorableDirection === 'higher-is-better') {
    if (isLowest) return 'var(--danger)'
    if (isMiddle) return 'var(--warning)'
    if (isHigh) return 'var(--success)'
    return MIDDLE
  }

  return MIDDLE
}

const CHART_METRICS: Record<ChartMetricKind, ChartMetricSpec> = {
  median: {
    kind: 'median',
    favorableDirection: 'lower-is-better',
    sortDirection: 'asc',
    yAxisDomain: ['auto', 'auto'],
    yAxisUnit: ' ms',
    extractValue: () => null,
  },
  p95: {
    kind: 'p95',
    favorableDirection: 'lower-is-better',
    sortDirection: 'asc',
    yAxisDomain: ['auto', 'auto'],
    yAxisUnit: ' ms',
    extractValue: () => null,
  },
  reliability: {
    kind: 'reliability',
    favorableDirection: 'higher-is-better',
    sortDirection: 'desc',
    yAxisDomain: [0, 100],
    yAxisUnit: '%',
    extractValue: (successRate) => (successRate !== null ? successRate * 100 : null),
  },
  blocking: {
    kind: 'blocking',
    favorableDirection: 'higher-is-better',
    sortDirection: 'desc',
    yAxisDomain: [0, 100],
    yAxisUnit: '%',
    extractValue: (_successRate, blockingEfficacy) =>
      blockingEfficacy !== null ? blockingEfficacy * 100 : null,
  },
}

export function getMetricSpec(kind: ChartMetricKind): ChartMetricSpec {
  return CHART_METRICS[kind]
}

export function formatRankLabel(oneBasedRank: number): string {
  return `#${oneBasedRank}`
}
