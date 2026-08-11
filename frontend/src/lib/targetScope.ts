import type { Provider, SelectionSource, SystemDnsPayload, TargetSnapshot } from './types'

export const CATALOG_SCOPES = ['global', 'europe', 'south-america', 'north-america', 'asia'] as const

export type CatalogScope = (typeof CATALOG_SCOPES)[number]

export type TargetScope = CatalogScope | 'all' | 'unknown'

export function isCatalogScope(value: string): value is CatalogScope {
  return (CATALOG_SCOPES as readonly string[]).includes(value)
}

/** Normalize a backend-produced region string into a valid target scope. */
export function normalizeScopeFromRegion(region: string | null | undefined): TargetScope {
  if (typeof region !== 'string') return 'unknown'
  if (isCatalogScope(region)) return region
  return 'unknown'
}

/** Providers eligible for a scope: matching region, globals, and detected ISP. */
export function scopeEligibleProviders(providers: Provider[], scope: TargetScope): Provider[] {
  if (scope === 'unknown' || scope === 'all') return providers
  return providers.filter((p) => p.region === scope || p.region === 'global' || p.id === 'isp-detectado')
}

/**
 * Derive the deterministic target resolver list for a scope.
 *
 * Catalog order is preserved, duplicate IPs (including a system DNS IP that
 * already appears in the catalog) are dropped, and detected system resolvers
 * are appended in order. `global`-scope resolution with no catalog targets
 * still yields the detected system DNS resolvers.
 */
export function deriveTargetResolvers(
  providers: Provider[],
  scope: TargetScope,
  systemDns: SystemDnsPayload | null,
): string[] {
  const seen = new Set<string>()
  const resolvers: string[] = []
  for (const provider of scopeEligibleProviders(providers, scope)) {
    for (const ip of provider.dns) {
      if (!seen.has(ip)) {
        seen.add(ip)
        resolvers.push(ip)
      }
    }
  }
  for (const ip of systemDns?.resolvers ?? []) {
    if (!seen.has(ip)) {
      seen.add(ip)
      resolvers.push(ip)
    }
  }
  return resolvers
}

export function selectionSourceFor(resolvers: string[], scopeDerived: string[]): SelectionSource {
  if (resolvers.length !== scopeDerived.length) return 'manual'
  return resolvers.every((resolver, index) => resolver === scopeDerived[index]) ? 'catalog' : 'manual'
}

export interface ProviderIndex {
  get(ip: string): string | null
}

/** Build the plan-003 immutable target snapshot from the exact measured set. */
export function buildTargetSnapshot(
  resolvers: string[],
  providerIndex: ProviderIndex,
  selectionSource: SelectionSource,
): TargetSnapshot {
  const providerIds: Record<string, string> = {}
  for (const ip of resolvers) {
    const providerId = providerIndex.get(ip)
    if (providerId && providerId !== 'isp-detectado') {
      providerIds[ip] = providerId
    }
  }
  return {
    resolver_ips: resolvers,
    selection_source: selectionSource,
    provider_ids: Object.keys(providerIds).length > 0 ? providerIds : null,
  }
}
