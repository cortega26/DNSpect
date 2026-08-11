import { describe, expect, it } from 'vitest'
import { colorForValue, formatRankLabel, getMetricSpec } from './chartPresentation'

describe('getMetricSpec', () => {
  it('median is lower-is-better ascending', () => {
    const spec = getMetricSpec('median')
    expect(spec.favorableDirection).toBe('lower-is-better')
    expect(spec.sortDirection).toBe('asc')
  })

  it('p95 is lower-is-better ascending', () => {
    const spec = getMetricSpec('p95')
    expect(spec.favorableDirection).toBe('lower-is-better')
    expect(spec.sortDirection).toBe('asc')
  })

  it('reliability is higher-is-better descending', () => {
    const spec = getMetricSpec('reliability')
    expect(spec.favorableDirection).toBe('higher-is-better')
    expect(spec.sortDirection).toBe('desc')
    expect(spec.yAxisDomain).toEqual([0, 100])
  })

  it('blocking is higher-is-better descending', () => {
    const spec = getMetricSpec('blocking')
    expect(spec.favorableDirection).toBe('higher-is-better')
    expect(spec.sortDirection).toBe('desc')
    expect(spec.yAxisDomain).toEqual([0, 100])
  })
})

describe('colorForValue', () => {
  const sorted = [10, 30, 50, 70, 90]

  it('lower-is-better: lowest values get success color', () => {
    expect(colorForValue(10, sorted, 'lower-is-better')).toBe('var(--success)')
    expect(colorForValue(30, sorted, 'lower-is-better')).toBe('var(--success)')
  })

  it('lower-is-better: highest values get danger color', () => {
    expect(colorForValue(90, sorted, 'lower-is-better')).toBe('var(--danger)')
    expect(colorForValue(70, sorted, 'lower-is-better')).toBe('var(--warning)')
  })

  it('higher-is-better: highest values get success color', () => {
    expect(colorForValue(90, sorted, 'higher-is-better')).toBe('var(--success)')
    expect(colorForValue(70, sorted, 'higher-is-better')).toBe('var(--warning)')
  })

  it('higher-is-better: lowest values get danger color', () => {
    expect(colorForValue(10, sorted, 'higher-is-better')).toBe('var(--danger)')
    expect(colorForValue(30, sorted, 'higher-is-better')).toBe('var(--danger)')
  })

  it('small data sets use accent', () => {
    expect(colorForValue(50, [50], 'higher-is-better')).toBe('var(--accent)')
    expect(colorForValue(50, [50, 60], 'higher-is-better')).toBe('var(--accent)')
  })

  it('null value uses accent', () => {
    expect(colorForValue(null, sorted, 'lower-is-better')).toBe('var(--accent)')
  })

  it('reliability 80 is danger and 100 is success', () => {
    const reliabilitySorted = [80, 85, 90, 95, 100]
    expect(colorForValue(80, reliabilitySorted, 'higher-is-better')).toBe('var(--danger)')
    expect(colorForValue(100, reliabilitySorted, 'higher-is-better')).toBe('var(--success)')
  })
})

describe('formatRankLabel', () => {
  it('produces #1 through #N', () => {
    expect(formatRankLabel(1)).toBe('#1')
    expect(formatRankLabel(3)).toBe('#3')
    expect(formatRankLabel(4)).toBe('#4')
    expect(formatRankLabel(12)).toBe('#12')
  })
})

describe('metric value extraction', () => {
  it.each(['median', 'p95'] as const)('%s extracts null from rate params', (kind) => {
    const spec = getMetricSpec(kind)
    expect(spec.extractValue(0.9, 0.5)).toBeNull()
  })

  it('reliability converts rate to percent', () => {
    const spec = getMetricSpec('reliability')
    expect(spec.extractValue(0.95, null)).toBe(95)
    expect(spec.extractValue(null, null)).toBeNull()
  })

  it('blocking converts efficacy to percent', () => {
    const spec = getMetricSpec('blocking')
    expect(spec.extractValue(null, 0.8)).toBe(80)
    expect(spec.extractValue(null, null)).toBeNull()
  })
})
