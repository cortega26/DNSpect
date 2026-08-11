import { describe, expect, it } from 'vitest'

import { resolveEgressScope } from './egress'

const withRegion = (region: string | null) => ({
  country_code: region === null ? null : 'XX',
  country_name: region === null ? null : 'Test',
  region,
  city: null,
  source: region === null ? null : 'GeoIP database',
})

describe('resolveEgressScope', () => {
  it('resolves an approved normalized region on success', async () => {
    const scope = await resolveEgressScope({
      getPublicIp: async () => '1.2.3.4',
      lookupGeoIp: async () => withRegion('south-america'),
    })
    expect(scope).toBe('south-america')
  })

  it('rejects a country-only response', async () => {
    const scope = await resolveEgressScope({
      getPublicIp: async () => '1.2.3.4',
      lookupGeoIp: async () => withRegion(null),
    })
    expect(scope).toBe('unknown')
  })

  it('handles an absent database or empty response as unknown', async () => {
    const scope = await resolveEgressScope({
      getPublicIp: async () => '1.2.3.4',
      lookupGeoIp: async () => ({ country_code: null, country_name: null, region: null, city: null, source: null }),
    })
    expect(scope).toBe('unknown')
  })

  it('treats a public-IP failure as unknown', async () => {
    const scope = await resolveEgressScope({
      getPublicIp: async () => null,
      lookupGeoIp: async () => withRegion('europe'),
    })
    expect(scope).toBe('unknown')
  })

  it('treats an aborted request as unknown without rejecting', async () => {
    const controller = new AbortController()
    const scope = await resolveEgressScope({
      signal: controller.signal,
      getPublicIp: async (signal) => {
        controller.abort()
        signal?.throwIfAborted()
        return '1.2.3.4'
      },
      lookupGeoIp: async () => withRegion('asia'),
    })
    expect(scope).toBe('unknown')
  })

  it('ignores an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const scope = await resolveEgressScope({
      signal: controller.signal,
      getPublicIp: async () => '1.2.3.4',
      lookupGeoIp: async () => withRegion('asia'),
    })
    expect(scope).toBe('unknown')
  })

  it('a late result after manual override cannot overwrite the choice', async () => {
    let current = true
    const scope = await resolveEgressScope({
      isCurrent: () => current,
      getPublicIp: async () => {
        current = false
        return '1.2.3.4'
      },
      lookupGeoIp: async () => withRegion('europe'),
    })
    expect(scope).toBe('unknown')
  })

  it('a lookup failure resolves as unknown', async () => {
    const scope = await resolveEgressScope({
      getPublicIp: async () => '1.2.3.4',
      lookupGeoIp: async () => {
        throw new Error('geoip unavailable')
      },
    })
    expect(scope).toBe('unknown')
  })
})
