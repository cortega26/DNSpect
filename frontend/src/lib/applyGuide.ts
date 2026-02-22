export type PlatformGroup = 'windows' | 'macos' | 'linux'

function uniqueDns(addresses: Array<string | null | undefined>): string[] {
  const deduped = new Set<string>()
  addresses.forEach((value) => {
    const normalized = String(value ?? '').trim()
    if (!normalized) return
    deduped.add(normalized)
  })
  return Array.from(deduped)
}

export function detectPlatformGroup(platformValue: string | null | undefined): PlatformGroup | null {
  const platform = String(platformValue ?? '').toLowerCase()
  if (!platform) return null
  if (platform.includes('win')) return 'windows'
  if (platform.includes('mac') || platform.includes('darwin') || platform.includes('osx')) return 'macos'
  if (platform.includes('linux')) return 'linux'
  return null
}

export function buildGuidedDnsSet(input: {
  primaryResolver?: string | null
  secondaryResolver?: string | null
  providerDns?: string[] | null
}): { all: string[]; ipv4: string[]; ipv6: string[] } {
  const all = uniqueDns([input.primaryResolver, input.secondaryResolver, ...(input.providerDns ?? [])])
  const ipv4 = all.filter((ip) => !ip.includes(':'))
  const ipv6 = all.filter((ip) => ip.includes(':'))
  return { all, ipv4, ipv6 }
}

export function buildDnsClipboardText(addresses: string[]): string {
  return uniqueDns(addresses).join('\n')
}
