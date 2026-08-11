import { getPublicIp, lookupGeoIp, type GeoIpResult } from './api'
import { normalizeScopeFromRegion, type TargetScope } from './targetScope'

export const EGRESS_TIMEOUT_MS = 5000

export interface EgressResolutionOptions {
  signal?: AbortSignal
  /** Must stay true for the result to be applied (manual-override guard). */
  isCurrent?: () => boolean
  getPublicIp?: (signal?: AbortSignal) => Promise<string | null>
  lookupGeoIp?: (ip: string, signal?: AbortSignal) => Promise<GeoIpResult>
}

/**
 * Resolve the approved automatic egress scope, best-effort and non-blocking.
 *
 * Data flow: one public-IP request (approved mechanism, finite timeout,
 * AbortSignal) followed by one local GeoIP lookup; only the normalized region
 * is consumed. Abort, failure, an absent result, or a superseded (no-longer
 * current) resolution all yield the approved `unknown` fallback and never
 * surface an error to the benchmark workflow.
 */
export async function resolveEgressScope(options: EgressResolutionOptions = {}): Promise<TargetScope> {
  const { signal, isCurrent = () => true } = options
  const getIp = options.getPublicIp ?? getPublicIp
  const lookup = options.lookupGeoIp ?? lookupGeoIp

  if (signal?.aborted || !isCurrent()) return 'unknown'

  let publicIp!: string | null
  try {
    publicIp = await getIp(signal)
  } catch {
    return 'unknown'
  }
  if (!publicIp || signal?.aborted || !isCurrent()) return 'unknown'

  let geo: GeoIpResult
  try {
    geo = await lookup(publicIp, signal)
  } catch {
    return 'unknown'
  }
  if (signal?.aborted || !isCurrent()) return 'unknown'

  return normalizeScopeFromRegion(geo.region ?? null)
}
