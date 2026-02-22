import { describe, expect, it } from 'vitest'

import { buildDnsClipboardText, buildGuidedDnsSet, detectPlatformGroup } from './applyGuide'

describe('apply guide dns formatting', () => {
  it('builds deduplicated clipboard text in stable order', () => {
    const text = buildDnsClipboardText(['1.1.1.1', '1.1.1.1', ' 8.8.8.8 ', '', '2606:4700:4700::1111'])
    expect(text).toBe('1.1.1.1\n8.8.8.8\n2606:4700:4700::1111')
  })

  it('splits dns recommendations by ip family', () => {
    const dns = buildGuidedDnsSet({
      primaryResolver: '1.1.1.1',
      secondaryResolver: '8.8.8.8',
      providerDns: ['2606:4700:4700::1111', '2606:4700:4700::1001'],
    })

    expect(dns.ipv4).toEqual(['1.1.1.1', '8.8.8.8'])
    expect(dns.ipv6).toEqual(['2606:4700:4700::1111', '2606:4700:4700::1001'])
    expect(dns.all).toEqual(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2606:4700:4700::1001'])
  })

  it('detects platform groups from system labels', () => {
    expect(detectPlatformGroup('Windows-11')).toBe('windows')
    expect(detectPlatformGroup('macOS')).toBe('macos')
    expect(detectPlatformGroup('linux')).toBe('linux')
    expect(detectPlatformGroup('unknown')).toBeNull()
  })
})
