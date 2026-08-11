import { describe, expect, it } from 'vitest'

import type { Provider } from './types'
import {
  buildTargetSnapshot,
  deriveTargetResolvers,
  isCatalogScope,
  normalizeScopeFromRegion,
  scopeEligibleProviders,
  selectionSourceFor,
} from './targetScope'

function provider(id: string, region: string | null, dns: string[]): Provider {
  return {
    id,
    name: id,
    dns,
    tags: [],
    region,
    country: null,
    goals: ['speed'],
    features: { filtering: 'no', malware_protection: 'no', family: 'no', doh: 'no', dot: 'no' },
    notes_es: '',
  }
}

const CLOUDFLARE = provider('cloudflare', 'global', ['1.1.1.1', '1.0.0.1'])
const MULLVAD = provider('mullvad', 'europe', ['194.242.2.2'])
const NICBR = provider('nicbr', 'south-america', ['200.160.0.8'])
const GOOGLE = provider('google', 'global', ['8.8.8.8'])
const ISPDETECTED = provider('isp-detectado', null, [])

const PROVIDERS = [CLOUDFLARE, MULLVAD, NICBR, GOOGLE, ISPDETECTED]

const SYSTEM_DNS = {
  resolvers: ['192.168.1.1', '1.1.1.1'],
  method: 'test',
  platform: 'test',
  detected_provider_id: 'isp-detectado',
}

const index = (get: (ip: string) => string | null) => ({ get })

describe('normalizeScopeFromRegion', () => {
  it('accepts every supported catalog region', () => {
    expect(normalizeScopeFromRegion('global')).toBe('global')
    expect(normalizeScopeFromRegion('europe')).toBe('europe')
    expect(normalizeScopeFromRegion('south-america')).toBe('south-america')
    expect(normalizeScopeFromRegion('north-america')).toBe('north-america')
    expect(normalizeScopeFromRegion('asia')).toBe('asia')
  })

  it('rejects raw ISO country codes', () => {
    expect(normalizeScopeFromRegion('CL')).toBe('unknown')
    expect(normalizeScopeFromRegion('US')).toBe('unknown')
    expect(normalizeScopeFromRegion('CO')).toBe('unknown')
  })

  it('maps unknown, absent, and unsupported values to unknown', () => {
    expect(normalizeScopeFromRegion(null)).toBe('unknown')
    expect(normalizeScopeFromRegion(undefined)).toBe('unknown')
    expect(normalizeScopeFromRegion('')).toBe('unknown')
    expect(normalizeScopeFromRegion('oceania')).toBe('unknown')
    expect(normalizeScopeFromRegion('africa')).toBe('unknown')
    expect(normalizeScopeFromRegion('continent')).toBe('unknown')
  })

  it('isCatalogScope rejects country codes and sentinels', () => {
    expect(isCatalogScope('europe')).toBe(true)
    expect(isCatalogScope('CL')).toBe(false)
    expect(isCatalogScope('all')).toBe(false)
    expect(isCatalogScope('unknown')).toBe(false)
    expect(isCatalogScope('auto')).toBe(false)
  })
})

describe('scopeEligibleProviders', () => {
  it('unknown and all keep every provider', () => {
    expect(scopeEligibleProviders(PROVIDERS, 'unknown')).toHaveLength(PROVIDERS.length)
    expect(scopeEligibleProviders(PROVIDERS, 'all')).toHaveLength(PROVIDERS.length)
  })

  it('filters to region plus globals and detected ISP', () => {
    const europe = scopeEligibleProviders(PROVIDERS, 'europe')
    expect(europe.map((p) => p.id).sort()).toEqual(['cloudflare', 'google', 'isp-detectado', 'mullvad'])
  })

  it('no-region provider without catalog targets resolves to globals', () => {
    const onlyRegional = [MULLVAD, NICBR]
    expect(scopeEligibleProviders(onlyRegional, 'south-america').map((p) => p.id)).toEqual(['nicbr'])
  })
})

describe('deriveTargetResolvers', () => {
  it('global scope resolves globals plus system DNS in order', () => {
    expect(deriveTargetResolvers(PROVIDERS, 'global', SYSTEM_DNS)).toEqual([
      '1.1.1.1',
      '1.0.0.1',
      '8.8.8.8',
      '192.168.1.1',
    ])
  })

  it('all scope resolves every catalog resolver plus system DNS', () => {
    expect(deriveTargetResolvers(PROVIDERS, 'all', SYSTEM_DNS)).toEqual([
      '1.1.1.1',
      '1.0.0.1',
      '194.242.2.2',
      '200.160.0.8',
      '8.8.8.8',
      '192.168.1.1',
    ])
  })

  it('deduplicates system DNS IPs already present in the catalog', () => {
    const resolvers = deriveTargetResolvers(PROVIDERS, 'all', SYSTEM_DNS)
    expect(resolvers.filter((r) => r === '1.1.1.1')).toHaveLength(1)
  })

  it('unknown scope behaves as all', () => {
    expect(deriveTargetResolvers(PROVIDERS, 'unknown', SYSTEM_DNS)).toEqual(
      deriveTargetResolvers(PROVIDERS, 'all', SYSTEM_DNS),
    )
  })

  it('a known scope with no catalog targets falls back to globals plus system DNS', () => {
    const noLocal = [MULLVAD, CLOUDFLARE]
    expect(deriveTargetResolvers(noLocal, 'south-america', SYSTEM_DNS)).toEqual([
      '1.1.1.1',
      '1.0.0.1',
      '192.168.1.1',
    ])
  })

  it('empty catalog with only system DNS still yields the system resolvers', () => {
    expect(deriveTargetResolvers([], 'europe', SYSTEM_DNS)).toEqual(['192.168.1.1', '1.1.1.1'])
  })
})

describe('selectionSourceFor', () => {
  const derived = ['1.1.1.1', '8.8.8.8']

  it('an exact scope-derived set is catalog', () => {
    expect(selectionSourceFor(derived, derived)).toBe('catalog')
  })

  it('a manual deviation is manual', () => {
    expect(selectionSourceFor(['1.1.1.1'], derived)).toBe('manual')
    expect(selectionSourceFor(['8.8.8.8', '1.1.1.1'], derived)).toBe('manual')
  })
})

describe('buildTargetSnapshot', () => {
  const resolverIndex = index((ip) => (ip === '1.1.1.1' ? 'cloudflare' : ip === '192.168.1.1' ? 'isp-detectado' : null))

  it('records the exact measured set with provider ids', () => {
    const snapshot = buildTargetSnapshot(['1.1.1.1', '192.168.1.1'], resolverIndex, 'catalog')
    expect(snapshot).toEqual({
      resolver_ips: ['1.1.1.1', '192.168.1.1'],
      selection_source: 'catalog',
      provider_ids: { '1.1.1.1': 'cloudflare' },
    })
  })

  it('drops detected-ISP provider ids and nulls an empty map', () => {
    const snapshot = buildTargetSnapshot(['192.168.1.1'], resolverIndex, 'manual')
    expect(snapshot.provider_ids).toBeNull()
  })
})
