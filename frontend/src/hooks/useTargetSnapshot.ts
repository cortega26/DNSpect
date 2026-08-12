import { useMemo } from 'react'

import { buildTargetSnapshot, deriveTargetResolvers, selectionSourceFor, type TargetScope } from '@/lib/targetScope'
import type { Provider, SystemDnsPayload, TargetSnapshot } from '@/lib/types'

export interface ResolverCatalogItem {
  resolver: string
  providerName: string
  providerId: string
}

export interface TargetSnapshotInput {
  resolvers: ReadonlySet<string>
  providers: Provider[]
  scope: TargetScope
  systemDns: SystemDnsPayload | null
  catalog: Map<string, ResolverCatalogItem>
}

/**
 * Single frontend builder of the plan-003 target snapshot shape (plan 038).
 * Previously built inline by three call sites in App.tsx with the same
 * shape; the backend's `TargetSnapshot` semantics (models.py) remain the
 * contract.
 */
export function useTargetSnapshot(input: TargetSnapshotInput): TargetSnapshot {
  const { resolvers, providers, scope, systemDns, catalog } = input
  return useMemo(() => {
    const resolverIps = Array.from(resolvers)
    const scopeDerived = deriveTargetResolvers(providers, scope, systemDns)
    return buildTargetSnapshot(
      resolverIps,
      { get: (ip) => catalog.get(ip)?.providerId ?? null },
      selectionSourceFor(resolverIps, scopeDerived),
    )
  }, [catalog, providers, resolvers, scope, systemDns])
}
