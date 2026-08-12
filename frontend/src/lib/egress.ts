import { getPublicIp, lookupGeoIp, type GeoIpResult } from './api'
import { normalizeScopeFromRegion, type TargetScope } from './targetScope'

export const EGRESS_TIMEOUT_MS = 5000

/**
 * Whether an in-flight egress resolution may still write back: the scope
 * source is still automatic AND the resolver set was not edited since the
 * resolution started. Manual edits win over the stale egress result.
 */
export function isEgressWriteBackCurrent(
  scopeSource: 'auto' | 'manual',
  selectionVersionAtStart: number,
  selectionVersionNow: number,
): boolean {
  return scopeSource === 'auto' && selectionVersionNow === selectionVersionAtStart
}

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
