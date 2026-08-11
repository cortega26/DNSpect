import { useCallback, useEffect, useRef, useState } from 'react'

import { getSystemDns, probeResolvers } from '@/lib/api'
import { compareProbeSummaries, parseProbeResponse, type ProbeOutcome, type ProbeSummary } from '@/lib/probe'
import { shouldAcceptAsyncResult } from '@/lib/runtime'
import type { SystemDnsPayload } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'

export interface VerificationSummary {
  outcome: ProbeOutcome
  recommended: ProbeSummary | null
  current: ProbeSummary | null
  currentResolver: string | null
  sampleSize: number
}

export interface GuidedVerification {
  verification: VerificationSummary | null
  verifyError: string | null
  isVerifying: boolean
  verify: (input: { recommendedResolver: string; systemDns: SystemDnsPayload | null }) => Promise<void>
  cancel: () => void
}

export function useGuidedVerification(onSystemDnsRefreshed: (dns: SystemDnsPayload) => void): GuidedVerification {
  const { t } = useI18n()

  const [verification, setVerification] = useState<VerificationSummary | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const verifySeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      verifySeqRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    verifySeqRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setVerification(null)
    setVerifyError(null)
    setIsVerifying(false)
  }, [])

  const verify = useCallback(
    async ({ recommendedResolver, systemDns }: { recommendedResolver: string; systemDns: SystemDnsPayload | null }) => {
      const requestSeq = verifySeqRef.current + 1
      verifySeqRef.current = requestSeq
      abortRef.current?.abort()
      setVerifyError(null)
      setVerification(null)
      setIsVerifying(true)

      try {
        let latestSystemDns = systemDns
        try {
          latestSystemDns = await getSystemDns()
          if (requestSeq === verifySeqRef.current) {
            onSystemDnsRefreshed(latestSystemDns)
          }
        } catch {
          // Keep the previously loaded system DNS if refresh fails.
        }

        const currentResolver = latestSystemDns?.resolvers?.[0] ?? null
        const resolverTargets = Array.from(new Set([recommendedResolver, currentResolver].filter(Boolean))) as string[]
        if (resolverTargets.length === 0) {
          setVerification({
            outcome: 'inconclusive',
            recommended: null,
            current: null,
            currentResolver: null,
            sampleSize: 0,
          })
          return
        }

        const probePayload = await probeResolvers({
          resolvers: resolverTargets,
          runs_per_resolver: 4,
          timeout_sec: 1.5,
        })
        if (!shouldAcceptAsyncResult(requestSeq, verifySeqRef.current, mountedRef.current)) return
        const parsed = parseProbeResponse(probePayload)
        const recommendedProbe = parsed.get(recommendedResolver) ?? null
        const currentProbe = currentResolver ? parsed.get(currentResolver) ?? null : null

        const outcome = compareProbeSummaries(recommendedProbe, currentProbe)
        const sampleSize = Math.min(
          recommendedProbe?.sampleCount ?? 0,
          currentProbe?.sampleCount ?? recommendedProbe?.sampleCount ?? 0,
        )

        setVerification({
          outcome,
          recommended: recommendedProbe,
          current: currentProbe,
          currentResolver,
          sampleSize,
        })
      } catch (e) {
        if (!shouldAcceptAsyncResult(requestSeq, verifySeqRef.current, mountedRef.current)) return
        setVerifyError(e instanceof Error ? e.message : t('applyGuide.verifyUnknownError'))
      } finally {
        if (requestSeq === verifySeqRef.current) {
          setIsVerifying(false)
        }
      }
    },
    [onSystemDnsRefreshed, t],
  )

  return { verification, verifyError, isVerifying, verify, cancel }
}
