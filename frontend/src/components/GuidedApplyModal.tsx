import { useMemo } from 'react'

import { useI18n } from '@/lib/useI18n'
import type { PlatformGroup } from '@/lib/applyGuide'
import { fmtMs } from '@/lib/utils'
import type { ProbeOutcome, ProbeSummary } from '@/lib/probe'

interface VerificationViewModel {
  outcome: ProbeOutcome
  recommended: ProbeSummary | null
  current: ProbeSummary | null
  currentResolver: string | null
  sampleSize: number
}

interface Props {
  open: boolean
  onClose: () => void
  detectedPlatformLabel: string
  detectedPlatformGroup: PlatformGroup | null
  resolverName: string
  recommendedPrimary: string | null
  recommendedSecondary: string | null
  ipv4Dns: string[]
  ipv6Dns: string[]
  allDns: string[]
  copyStatus: 'idle' | 'success' | 'error'
  isVerifying: boolean
  verifyError: string | null
  verification: VerificationViewModel | null
  onCopyIpv4: () => void
  onCopyIpv6: () => void
  onCopyAll: () => void
  onVerify: () => void
}

function formatFailureRate(value: number | null | undefined, fallback: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`
}

function outcomeTone(outcome: ProbeOutcome | null): 'good' | 'neutral' | 'bad' {
  if (outcome === 'better') return 'good'
  if (outcome === 'worse') return 'bad'
  return 'neutral'
}

export function GuidedApplyModal({
  open,
  onClose,
  detectedPlatformLabel,
  detectedPlatformGroup,
  resolverName,
  recommendedPrimary,
  recommendedSecondary,
  ipv4Dns,
  ipv6Dns,
  allDns,
  copyStatus,
  isVerifying,
  verifyError,
  verification,
  onCopyIpv4,
  onCopyIpv6,
  onCopyAll,
  onVerify,
}: Props) {
  const { t } = useI18n()

  const openWindows = detectedPlatformGroup === 'windows' || detectedPlatformGroup === null
  const openMacos = detectedPlatformGroup === 'macos'
  const openLinux = detectedPlatformGroup === 'linux'

  const verificationTone = outcomeTone(verification?.outcome ?? null)
  const verificationLabel = useMemo(() => {
    if (!verification) return null
    if (verification.outcome === 'better') return t('applyGuide.verifyResultBetter')
    if (verification.outcome === 'worse') return t('applyGuide.verifyResultWorse')
    if (verification.outcome === 'same') return t('applyGuide.verifyResultSame')
    if (verification.outcome === 'low_confidence') return t('applyGuide.verifyResultLowConfidence')
    return t('applyGuide.verifyResultInconclusive')
  }, [t, verification])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guided-apply-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('applyGuide.modalTitle')}</h3>
          <button type="button" onClick={onClose}>
            {t('modal.close')}
          </button>
        </div>

        <section className="guided-section">
          <p className="muted">{t('applyGuide.safetyNoPrivileges')}</p>
          <p>
            <strong>{t('applyGuide.recommendedProvider')}</strong> {resolverName}
          </p>
          {recommendedPrimary ? <p>{t('applyGuide.primary', { resolver: recommendedPrimary })}</p> : null}
          {recommendedSecondary ? <p>{t('applyGuide.secondary', { resolver: recommendedSecondary })}</p> : null}
          <p>{t('applyGuide.pasteHint')}</p>
          <div className="guided-dns-grid">
            <article className="metric-card">
              <h4>{t('applyGuide.ipv4')}</h4>
              <code>{ipv4Dns.length > 0 ? ipv4Dns.join(', ') : t('summary.na')}</code>
            </article>
            <article className="metric-card">
              <h4>{t('applyGuide.ipv6')}</h4>
              <code>{ipv6Dns.length > 0 ? ipv6Dns.join(', ') : t('summary.na')}</code>
            </article>
          </div>
          <div className="actions-row">
            <button type="button" className="btn-secondary" onClick={onCopyIpv4} disabled={ipv4Dns.length === 0}>
              {t('applyGuide.copyIpv4')}
            </button>
            <button type="button" className="btn-secondary" onClick={onCopyIpv6} disabled={ipv6Dns.length === 0}>
              {t('applyGuide.copyIpv6')}
            </button>
            <button type="button" className="btn-primary" onClick={onCopyAll} disabled={allDns.length === 0}>
              {t('applyGuide.copyAll')}
            </button>
          </div>
          {copyStatus === 'success' ? <p className="helper-text">{t('applyGuide.copySuccess')}</p> : null}
          {copyStatus === 'error' ? <p className="helper-text">{t('applyGuide.copyError')}</p> : null}
        </section>

        <section className="guided-section">
          <h4>{t('applyGuide.title')}</h4>
          <p>{t('applyGuide.lead')}</p>
          <p className="muted">{t('applyGuide.detectedPlatform', { platform: detectedPlatformLabel })}</p>

          <details className="guide-platform" open={openWindows}>
            <summary>{t('applyGuide.windowsTitle')}</summary>
            <ol className="guide-steps">
              <li>{t('applyGuide.windowsStep1')}</li>
              <li>{t('applyGuide.windowsStep2')}</li>
              <li>{t('applyGuide.windowsStep3')}</li>
            </ol>
          </details>

          <details className="guide-platform" open={openMacos}>
            <summary>{t('applyGuide.macosTitle')}</summary>
            <ol className="guide-steps">
              <li>{t('applyGuide.macosStep1')}</li>
              <li>{t('applyGuide.macosStep2')}</li>
              <li>{t('applyGuide.macosStep3')}</li>
            </ol>
          </details>

          <details className="guide-platform" open={openLinux}>
            <summary>{t('applyGuide.linuxTitle')}</summary>
            <ol className="guide-steps">
              <li>{t('applyGuide.linuxStep1')}</li>
              <li>{t('applyGuide.linuxStep2')}</li>
              <li>{t('applyGuide.linuxStep3')}</li>
            </ol>
          </details>

          <details className="guide-platform">
            <summary>{t('applyGuide.routerTitle')}</summary>
            <ol className="guide-steps">
              <li>{t('applyGuide.routerStep1')}</li>
              <li>{t('applyGuide.routerStep2')}</li>
              <li>{t('applyGuide.routerStep3')}</li>
            </ol>
          </details>
        </section>

        <section className="guided-section">
          <h4>{t('applyGuide.verifyTitle')}</h4>
          <p>{t('applyGuide.verifyLead')}</p>
          <button type="button" className="btn-primary" onClick={onVerify} disabled={isVerifying}>
            {isVerifying ? t('applyGuide.verifyRunning') : t('applyGuide.verifyAction')}
          </button>

          {verifyError ? (
            <p className="recommendation-warning" role="alert">
              {t('applyGuide.verifyError', { error: verifyError })}
            </p>
          ) : null}

          {verification ? (
            <article className={`guided-verification guided-verification-${verificationTone}`}>
              <h4>{verificationLabel}</h4>
              <p className="muted">
                {t('applyGuide.verifyConfidence', {
                  samples: Math.max(0, verification.sampleSize),
                })}
              </p>

              <div className="guided-verify-grid">
                <article className="metric-card">
                  <h4>{t('applyGuide.verifyRecommendedResolver')}</h4>
                  <p>{verification.recommended?.resolver ?? t('summary.na')}</p>
                  <p>{t('applyGuide.verifyMedian', { value: fmtMs(verification.recommended?.medianMs ?? null) })}</p>
                  <p>
                    {t('applyGuide.verifyFailureRate', {
                      value: formatFailureRate(verification.recommended?.failureRate, t('summary.na')),
                    })}
                  </p>
                </article>
                <article className="metric-card">
                  <h4>{t('applyGuide.verifyCurrentResolver')}</h4>
                  <p>{verification.currentResolver ?? t('summary.na')}</p>
                  <p>{t('applyGuide.verifyMedian', { value: fmtMs(verification.current?.medianMs ?? null) })}</p>
                  <p>
                    {t('applyGuide.verifyFailureRate', {
                      value: formatFailureRate(verification.current?.failureRate, t('summary.na')),
                    })}
                  </p>
                </article>
              </div>

              {(verification.outcome === 'worse' ||
                verification.outcome === 'inconclusive' ||
                verification.outcome === 'low_confidence') && (
                <div className="guided-safety-notes">
                  {verification.outcome === 'low_confidence' ? <p>{t('applyGuide.verifyLowConfidenceHint')}</p> : null}
                  <p>{t('applyGuide.verifyWorseHint')}</p>
                  <p>{t('applyGuide.revertHint')}</p>
                  <p>{t('applyGuide.rerunHint')}</p>
                </div>
              )}
            </article>
          ) : null}
        </section>
      </div>
    </div>
  )
}
