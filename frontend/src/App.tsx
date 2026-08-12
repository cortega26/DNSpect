import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useFocusTrap } from '@/lib/useFocusTrap'
import type { TimeoutPreset } from '@/components/DashboardControls'
import { GuidedApplyModal } from '@/components/GuidedApplyModal'
import { LabWorkspace } from '@/components/LabWorkspace'
import { LocaleMenu } from '@/components/LocaleMenu'
import { ModeSwitcher } from '@/components/ModeSwitcher'
import { QuickCheckPanel } from '@/components/QuickCheckPanel'
import type { WatchSessionConfig } from '@/components/WatchPanel'
import { useBenchmarkSession } from '@/hooks/useBenchmarkSession'
import { useGuidedVerification } from '@/hooks/useGuidedVerification'
import { useProtocolComparison } from '@/hooks/useProtocolComparison'
import { useRunComparison } from '@/hooks/useRunComparison'
import { useRunHistory } from '@/hooks/useRunHistory'
import { useTargetSnapshot, type ResolverCatalogItem } from '@/hooks/useTargetSnapshot'

const ResolverDetailModal = lazy(() => import('@/components/ResolverDetailModal').then((m) => ({ default: m.ResolverDetailModal })))
import { buildDnsClipboardText, buildGuidedDnsSet, detectPlatformGroup } from '@/lib/applyGuide'
import { useI18n } from '@/lib/useI18n'
import { computeRunningEtaText, formatEtaRange } from '@/lib/eta'
import { getCapabilities, getProviders, getSystemDns } from '@/lib/api'
import { isEgressWriteBackCurrent, resolveEgressScope } from '@/lib/egress'
import {
  buildBenchmarkCsv,
  buildShareSummary,
  clearSavedLastRun,
  type LoadSavedLastRunResult,
  loadSavedLastRun,
  persistSavedLastRun,
  resolveRecommendedResult,
  type SavedLastRunV1,
} from '@/lib/reporting'
import {
  computeStallThresholds,
  isSmallImprovement,
  terminalRefreshKey,
} from '@/lib/runtime'
import { useTheme } from '@/lib/useTheme'
import type { AppMode, BenchmarkMode, BenchmarkProtocol, Provider, ResolverResult, ScoringProfile, SystemDnsPayload } from '@/lib/types'
import { API_BASE, fmtMs, isWatchRun, latestUserRun, providersByGoal, regionLabelKey, resolverReliabilityScore } from '@/lib/utils'
import {
  buildTargetSnapshot,
  deriveTargetResolvers,
  scopeEligibleProviders,
  selectionSourceFor,
  type TargetScope,
} from '@/lib/targetScope'

const MODE_RUNS: Record<BenchmarkMode, number> = {
  quick: 12,
  standard: 30,
  exhaustive: 80,
}

const APP_MODE_STORAGE_KEY = 'dnspect-mode'

const BASIC_TIMEOUT_PRESET: Record<TimeoutPreset, number> = {
  low: 1.5,
  medium: 2,
  high: 3,
}

const FALLBACK_PROVIDER_NOTES_ES = 'Lista de proveedores de respaldo cuando la API de proveedores del backend no está disponible.'

const FALLBACK_PROVIDERS: Provider[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    dns: ['1.1.1.1', '1.0.0.1'],
    tags: ['global', 'anycast', 'privacidad'],
    region: 'global',
    country: null,
    goals: ['speed', 'privacy'],
    features: {
      filtering: 'no',
      malware_protection: 'no',
      family: 'no',
      doh: 'yes',
      dot: 'yes',
    },
    notes_es: FALLBACK_PROVIDER_NOTES_ES,
  },
  {
    id: 'google',
    name: 'Google Public DNS',
    dns: ['8.8.8.8', '8.8.4.4'],
    tags: ['global', 'anycast'],
    region: 'global',
    country: null,
    goals: ['speed'],
    features: {
      filtering: 'no',
      malware_protection: 'no',
      family: 'no',
      doh: 'yes',
      dot: 'yes',
    },
    notes_es: FALLBACK_PROVIDER_NOTES_ES,
  },
  {
    id: 'quad9',
    name: 'Quad9',
    dns: ['9.9.9.9', '149.112.112.112'],
    tags: ['global', 'privacidad', 'seguridad'],
    region: 'global',
    country: null,
    goals: ['security', 'privacy', 'speed'],
    features: {
      filtering: 'yes',
      malware_protection: 'yes',
      family: 'no',
      doh: 'yes',
      dot: 'yes',
    },
    notes_es: FALLBACK_PROVIDER_NOTES_ES,
  },
]

function parseQueries(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((query) => query.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function nearestTimeoutPreset(seconds: number): TimeoutPreset {
  const entries = Object.entries(BASIC_TIMEOUT_PRESET) as Array<[TimeoutPreset, number]>
  return entries.reduce<TimeoutPreset>((closest, [preset, value]) => {
    const currentDelta = Math.abs(BASIC_TIMEOUT_PRESET[closest] - seconds)
    const nextDelta = Math.abs(value - seconds)
    return nextDelta < currentDelta ? preset : closest
  }, 'medium')
}

function formatDurationCompact(seconds: number): string {
  const safeSeconds = Math.max(5, Math.round(seconds))
  if (safeSeconds >= 60) {
    return `~${Math.max(1, Math.round(safeSeconds / 60))} min`
  }
  return `~${safeSeconds} s`
}

function formatRemainingTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  if (minutes <= 0) return `${remainder}s`
  return `${minutes}m ${remainder}s`
}

function parseTimestampMs(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function triggerDownload(content: BlobPart, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}

function App() {
  const { language, setLanguage, t } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const nextThemeLabel = theme === 'dark' ? t('header.themeToggleToLight') : t('header.themeToggleToDark')

  const [providers, setProviders] = useState<Provider[]>([])
  const [systemDns, setSystemDns] = useState<SystemDnsPayload | null>(null)
  const [doqAvailable, setDoqAvailable] = useState<boolean>(true)
  const [selectedResolvers, setSelectedResolvers] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<BenchmarkMode>('standard')
  const [protocol, setProtocol] = useState<BenchmarkProtocol>('udp')
  const [runs, setRuns] = useState<number>(MODE_RUNS.standard)
  const [timeoutSec, setTimeoutSec] = useState<number>(2)
  const [timeoutPreset, setTimeoutPreset] = useState<TimeoutPreset>('medium')
  const [queriesText, setQueriesText] = useState<string>('')
  const [scoringProfile, setScoringProfile] = useState<ScoringProfile>('speed')
  const [targetScope, setTargetScope] = useState<TargetScope>('unknown')
  const [scopeSource, setScopeSource] = useState<'auto' | 'manual'>('auto')
  const scopeSourceRef = useRef<'auto' | 'manual'>('auto')
  const selectionVersionRef = useRef(0)
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false)
  const [appMode, setAppMode] = useState<AppMode>(() => {
    try {
      return window.sessionStorage.getItem(APP_MODE_STORAGE_KEY) === 'lab' ? 'lab' : 'quick'
    } catch {
      return 'quick'
    }
  })
  useEffect(() => {
    try {
      window.sessionStorage.setItem(APP_MODE_STORAGE_KEY, appMode)
    } catch {
      // Best-effort persistence; a blocked sessionStorage must not break the UI.
    }
  }, [appMode])

  const session = useBenchmarkSession()
  const { benchmarkId, status, error, selectedResult, loadingSamples, viewingSavedRun, reportError } = session
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [onlyReliable, setOnlyReliable] = useState<boolean>(false)
  const [resolverListOpen, setResolverListOpen] = useState<boolean>(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [summaryCopyStatus, setSummaryCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [guidedApplyOpen, setGuidedApplyOpen] = useState<boolean>(false)
  const [guidedCopyStatus, setGuidedCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const guidedVerification = useGuidedVerification(setSystemDns)
  const [savedLastRun, setSavedLastRun] = useState<SavedLastRunV1 | null>(null)
  const [savedRunNotice, setSavedRunNotice] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [isInitializing, setIsInitializing] = useState<boolean>(true)
  const { history, historyLoading, refresh: refreshRunHistory } = useRunHistory(status?.id ?? null)
  const lastTerminalKeyRef = useRef<string | null>(null)
  const terminalKey = terminalRefreshKey(status, lastTerminalKeyRef.current)
  useEffect(() => {
    if (terminalKey === null) return
    lastTerminalKeyRef.current = terminalKey
    void refreshRunHistory()
  }, [terminalKey, refreshRunHistory])
  const comparison = useRunComparison()
  const {
    baselineId: comparisonBaselineId,
    candidateId: comparisonCandidateId,
    comparison: comparisonData,
    comparisonLoading,
    comparisonError,
    selectPair: selectComparisonPair,
    clear: clearComparison,
  } = comparison
  const [comparisonOpen, setComparisonOpen] = useState<boolean>(false)
  const [comparisonProtocols, setComparisonProtocols] = useState<BenchmarkProtocol[]>(['udp', 'dot'])
  const protocolComparison = useProtocolComparison()
  const {
    preflight: comparisonPreflight,
    preflightLoading: comparisonPreflightLoading,
    preflightError: comparisonPreflightError,
    comparison: protocolComparisonData,
    comparisonId: protocolComparisonId,
    comparisonLoading: protocolComparisonLoading,
    comparisonError: protocolComparisonError,
    runPreflight: runProtocolComparisonPreflight,
    start: startProtocolComparisonRun,
    clear: clearProtocolComparison,
  } = protocolComparison
  const rankingPanelRef = useRef<HTMLElement | null>(null)
  const resolverListRef = useRef<HTMLDivElement>(null)
  useFocusTrap(resolverListRef, resolverListOpen)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    void getCapabilities(controller.signal)
      .then((caps) => {
        if (cancelled) return
        setDoqAvailable(caps.doq === true)
      })
      .catch(() => {
        if (cancelled) return
        setDoqAvailable(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const loaded: LoadSavedLastRunResult = loadSavedLastRun()
    setSavedLastRun(loaded.saved)
    if (loaded.invalidationReason === 'schema_version_mismatch') {
      setSavedRunNotice(t('lastRun.schemaMismatch'))
    } else if (loaded.invalidationReason === 'malformed_payload') {
      setSavedRunNotice(t('lastRun.invalidPayload'))
    } else {
      setSavedRunNotice(null)
    }
  }, [t])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function init() {
      let providersRes!: Provider[]
      let dnsRes!: SystemDnsPayload | null
      try {
        const [providersResult, dnsResult] = await Promise.allSettled([getProviders(), getSystemDns()])
        if (cancelled) return

        const providersResRaw = providersResult.status === 'fulfilled' ? providersResult.value : []
        providersRes = providersResRaw.length > 0 ? providersResRaw : FALLBACK_PROVIDERS
        dnsRes = dnsResult.status === 'fulfilled' ? dnsResult.value : null

        setProviders(providersRes)
        setSystemDns(dnsRes)
        selectionVersionRef.current += 1
        setSelectedResolvers(new Set(deriveTargetResolvers(providersRes, 'unknown', dnsRes)))

        if (providersResult.status === 'rejected' || dnsResult.status === 'rejected') {
          let reason: unknown = 'Error al cargar los datos iniciales'
          if (providersResult.status === 'rejected') {
            reason = providersResult.reason
          } else if (dnsResult.status === 'rejected') {
            reason = dnsResult.reason
          }
          reportError(reason instanceof Error ? reason.message : 'Error al cargar los datos iniciales')
        }
      } finally {
        if (!cancelled) setIsInitializing(false)
      }

      // Automatic egress scope: best-effort, after the critical init settles.
      const selectionVersionAtStart = selectionVersionRef.current
      const scope = await resolveEgressScope({
        signal: controller.signal,
        isCurrent: () =>
          isEgressWriteBackCurrent(scopeSourceRef.current, selectionVersionAtStart, selectionVersionRef.current),
      })
      if (cancelled || scope === 'unknown') return
      setTargetScope(scope)
      setSelectedResolvers(new Set(deriveTargetResolvers(providersRes, scope, dnsRes)))
    }
    void init()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [reportError])

  const handleSelectRun = useCallback(
    async (runId: string) => {
      setCopyStatus('idle')
      setSummaryCopyStatus('idle')
      await session.selectRun(runId)
    },
    [session],
  )

  useEffect(() => {
    setTimeoutPreset(nearestTimeoutPreset(timeoutSec))
  }, [timeoutSec])

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const scoringFilteredProviders = useMemo(() => providersByGoal(providers, scoringProfile), [providers, scoringProfile])
  const regionFilteredProviders = useMemo(
    () => scopeEligibleProviders(scoringFilteredProviders, targetScope),
    [scoringFilteredProviders, targetScope],
  )
  const resolverCatalog = useMemo(() => {
    const catalog = new Map<string, ResolverCatalogItem>()
    providers.forEach((provider) => {
      provider.dns.forEach((ip) => {
        catalog.set(ip, {
          resolver: ip,
          providerName: provider.name,
          providerId: provider.id,
        })
      })
    })
    ;(systemDns?.resolvers ?? []).forEach((resolver) => {
      if (!catalog.has(resolver)) {
        catalog.set(resolver, {
          resolver,
          providerName: t('group.isp'),
          providerId: 'isp-detectado',
        })
      }
    })
    return catalog
  }, [providers, systemDns?.resolvers, t])

  const targetSnapshot = useTargetSnapshot({
    resolvers: selectedResolvers,
    providers,
    scope: targetScope,
    systemDns,
    catalog: resolverCatalog,
  })

  const protocolComparisonPayload = useMemo(() => {
    if (!comparisonOpen || comparisonProtocols.length < 2) return null
    const customQueries = parseQueries(queriesText)
    return {
      protocols: comparisonProtocols,
      target_snapshot: targetSnapshot,
      scoring_profile: scoringProfile,
      mode,
      runs,
      timeout_sec: timeoutSec,
      ...(customQueries.length > 0 ? { queries: customQueries } : {}),
    }
  }, [comparisonOpen, comparisonProtocols, mode, queriesText, runs, scoringProfile, targetSnapshot, timeoutSec])

  const watchSessionConfig = useMemo<WatchSessionConfig | null>(() => {
    if (selectedResolvers.size === 0) return null
    const customQueries = parseQueries(queriesText)
    return {
      target_snapshot: targetSnapshot,
      protocol,
      scoring_profile: scoringProfile,
      mode,
      runs,
      timeout_sec: timeoutSec,
      ...(customQueries.length > 0 ? { queries: customQueries } : {}),
    }
  }, [mode, protocol, queriesText, runs, scoringProfile, selectedResolvers, targetSnapshot, timeoutSec])

  useEffect(() => {
    if (!protocolComparisonPayload) return
    const handle = window.setTimeout(() => {
      void runProtocolComparisonPreflight(protocolComparisonPayload)
    }, 300)
    return () => window.clearTimeout(handle)
  }, [protocolComparisonPayload, runProtocolComparisonPreflight])

  const protocolComparisonActive = Boolean(
    protocolComparisonData?.status === 'queued' || protocolComparisonData?.status === 'running',
  )

  function handleToggleComparison() {
    if (comparisonOpen) {
      clearProtocolComparison()
    }
    setComparisonOpen((prev) => !prev)
  }

  function handleToggleComparisonProtocol(nextProtocol: BenchmarkProtocol) {
    setComparisonProtocols((prev) => {
      if (prev.includes(nextProtocol)) {
        return prev.filter((protocol) => protocol !== nextProtocol)
      }
      return [...prev, nextProtocol]
    })
  }

  function handleStartComparison() {
    if (!protocolComparisonPayload) return
    void startProtocolComparisonRun(protocolComparisonPayload)
  }
  const selectedResolverCatalog = useMemo(
    () =>
      Array.from(selectedResolvers)
        .map((resolver) => resolverCatalog.get(resolver) ?? { resolver, providerName: t('summary.na') })
        .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.resolver.localeCompare(b.resolver)),
    [resolverCatalog, selectedResolvers, t],
  )

  const decisiveRanking = useMemo(() => status?.results ?? [], [status?.results])
  const primaryResult = useMemo(() => resolveRecommendedResult(status), [status])
  const recommendationRun = useMemo(() => {
    if (status?.status === 'done' && !isWatchRun(status)) return status
    return latestUserRun(history)
  }, [history, status])
  const viewingWatchRun = useMemo(() => isWatchRun(status), [status])
  const picks = useMemo(() => {
    const primary = primaryResult?.resolver ?? decisiveRanking[0]?.resolver
    const secondary = decisiveRanking.find((item) => item.resolver !== primary)?.resolver
    return { primary, secondary }
  }, [decisiveRanking, primaryResult?.resolver])
  const guidedDnsSet = useMemo(() => {
    const providerDns = primaryResult ? providerById.get(primaryResult.provider_id)?.dns ?? [] : []
    return buildGuidedDnsSet({
      primaryResolver: primaryResult?.resolver ?? null,
      secondaryResolver: picks.secondary ?? null,
      providerDns,
    })
  }, [picks.secondary, primaryResult, providerById])

  const filteredResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return decisiveRanking.filter((row) => {
      const tags = providerById.get(row.provider_id)?.tags ?? []
      const searchable = `${row.resolver} ${row.provider_name} ${tags.join(' ')}`.toLowerCase()
      const matchesSearch = term.length === 0 || searchable.includes(term)
      const matchesReliable = !onlyReliable || row.stats.failure_rate <= 0.2
      return matchesSearch && matchesReliable
    })
  }, [onlyReliable, providerById, searchTerm, decisiveRanking])
  const workloadMetrics = useMemo(() => {
    const resolvers = selectedResolvers.size
    const safeRuns = Number.isFinite(runs) && runs > 0 ? runs : MODE_RUNS[mode]
    const safeTimeout = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : BASIC_TIMEOUT_PRESET[timeoutPreset]
    const timeoutLabel = safeTimeout % 1 === 0 ? safeTimeout.toFixed(0) : safeTimeout.toFixed(1)

    if (resolvers <= 0 || safeRuns <= 0 || safeTimeout <= 0) {
      return {
        summary: t('controls.workloadSummaryNoEta', {
          resolvers: Math.max(0, resolvers),
          runs: Math.max(0, safeRuns),
          timeout: timeoutLabel,
        }),
        estimatedSeconds: 0,
      }
    }

    const operations = resolvers * safeRuns
    const perOpLower = Math.min(0.15, safeTimeout * 0.03)
    const perOpUpper = Math.min(0.8, safeTimeout * 0.2)
    const lowerBoundSec = Math.max(5, operations * perOpLower)
    const upperBoundSec = Math.max(5, operations * perOpUpper)
    const eta = formatEtaRange(lowerBoundSec, upperBoundSec)

    return {
      summary: t('controls.workloadSummary', {
        resolvers,
        runs: safeRuns,
        timeout: timeoutLabel,
        eta,
      }),
      estimatedSeconds: (lowerBoundSec + upperBoundSec) / 2,
    }
  }, [mode, runs, selectedResolvers.size, t, timeoutPreset, timeoutSec])
  const startCtaHelpText = useMemo(() => {
    return t('controls.startSubtext', {
      count: selectedResolvers.size,
      eta: formatDurationCompact(workloadMetrics.estimatedSeconds),
    })
  }, [selectedResolvers.size, t, workloadMetrics.estimatedSeconds])

  const isRunning = status?.status === 'running' || status?.status === 'queued'
  const progressPct = status?.progress.total
    ? Math.min(100, Math.max(0, Math.round((status.progress.current / status.progress.total) * 100)))
    : 0
  const lastSampleAtMs = useMemo(() => parseTimestampMs(status?.progress.last_sample_at), [status?.progress.last_sample_at])
  const lastProgressAgeMs = useMemo(() => {
    if (!isRunning || lastSampleAtMs === null) return null
    return Math.max(0, nowMs - lastSampleAtMs)
  }, [isRunning, lastSampleAtMs, nowMs])
  const stallThresholds = useMemo(() => computeStallThresholds(status?.timeout_sec ?? timeoutSec), [status?.timeout_sec, timeoutSec])
  const runningHealthMessage = useMemo(() => {
    if (!isRunning) return t('status.runningHealthNormal')
    if (lastProgressAgeMs === null || lastProgressAgeMs <= stallThresholds.slowMs) {
      return t('status.runningHealthNormal')
    }
    if (lastProgressAgeMs <= stallThresholds.stalledMs) {
      return t('status.runningHealthSlow')
    }
    return t('status.runningHealthStalled')
  }, [isRunning, lastProgressAgeMs, stallThresholds.slowMs, stallThresholds.stalledMs, t])
  const lastProgressLabel = useMemo(() => {
    if (lastProgressAgeMs === null) return t('status.lastProgressUnknown')
    return t('status.lastProgressAgo', { seconds: Math.floor(lastProgressAgeMs / 1000) })
  }, [lastProgressAgeMs, t])
  const progressTotalResolvers = useMemo(() => {
    if (!status || !status.runs || status.runs <= 0 || !status.progress.total) return selectedResolvers.size
    return Math.max(1, Math.ceil(status.progress.total / status.runs))
  }, [selectedResolvers.size, status])
  const progressCompletedResolvers = useMemo(() => {
    if (!status || !status.runs || status.runs <= 0) return 0
    return Math.min(progressTotalResolvers, Math.floor(status.progress.current / status.runs))
  }, [progressTotalResolvers, status])
  const measuredAvgLatencyMs = status?.progress.avg_latency_ms ?? null
  const runningTimeRemaining = useMemo(() => {
    if (!status || status.status !== 'running') return null
    const total = status.progress.total
    const current = status.progress.current
    const startedAt = Date.parse(status.started_at)
    if (!Number.isFinite(total) || !Number.isFinite(current) || !Number.isFinite(startedAt) || total <= 0 || current <= 0) {
      return null
    }
    const elapsedSec = (Date.now() - startedAt) / 1000
    if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return null
    const remainingOps = Math.max(0, total - current)
    const secondsPerOp = elapsedSec / current
    return remainingOps * secondsPerOp
  }, [status])
  useEffect(() => {
    if (!isRunning) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])

  useEffect(() => {
    if (copyStatus !== 'success' && summaryCopyStatus !== 'success' && guidedCopyStatus !== 'success') return
    const timer = window.setTimeout(() => {
      if (copyStatus === 'success') setCopyStatus('idle')
      if (summaryCopyStatus === 'success') setSummaryCopyStatus('idle')
      if (guidedCopyStatus === 'success') setGuidedCopyStatus('idle')
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [copyStatus, summaryCopyStatus, guidedCopyStatus])

  useEffect(() => {
    if (!status || status.status !== 'done' || viewingSavedRun) return
    const metadata = {
      timestamp: new Date().toISOString(),
      platform:
        systemDns?.platform ??
        (typeof window !== 'undefined' && typeof window.navigator?.platform === 'string' ? window.navigator.platform : null),
      app_version:
        typeof import.meta.env.VITE_APP_VERSION === 'string' && import.meta.env.VITE_APP_VERSION.length > 0
          ? import.meta.env.VITE_APP_VERSION
          : null,
    }
    const persisted = persistSavedLastRun(status, metadata)
    if (persisted) setSavedLastRun(persisted)
  }, [status, systemDns?.platform, viewingSavedRun])

  function handleStart() {
    guidedVerification.cancel()

    setCopyStatus('idle')
    setSummaryCopyStatus('idle')
    setGuidedApplyOpen(false)
    setGuidedCopyStatus('idle')
    setSavedRunNotice(null)

    const customQueries = parseQueries(queriesText)
    const resolverIps = Array.from(selectedResolvers)
    const payload = {
      mode,
      scoring_profile: scoringProfile,
      protocol,
      runs,
      timeout_sec: timeoutSec,
      resolvers: resolverIps,
      ...(customQueries.length > 0 ? { queries: customQueries } : {}),
      target_snapshot: targetSnapshot,
    }
    void session.start(payload)
  }

  const quickResolvers = useMemo(() => deriveTargetResolvers(providers, 'unknown', systemDns), [providers, systemDns])
  const quickTargetSnapshot = useMemo(
    () =>
      buildTargetSnapshot(
        quickResolvers,
        { get: (ip) => resolverCatalog.get(ip)?.providerId ?? null },
        selectionSourceFor(quickResolvers, quickResolvers),
      ),
    [quickResolvers, resolverCatalog],
  )

  function handleQuickStart() {
    guidedVerification.cancel()

    setCopyStatus('idle')
    setSummaryCopyStatus('idle')
    setGuidedApplyOpen(false)
    setGuidedCopyStatus('idle')
    setSavedRunNotice(null)

    void session.start({
      mode: 'quick',
      goal: 'speed',
      scoring_profile: 'speed',
      protocol,
      runs: MODE_RUNS.quick,
      timeout_sec: timeoutSec,
      resolvers: quickResolvers,
      target_snapshot: quickTargetSnapshot,
    })
  }

  function toggleResolver(ip: string) {
    selectionVersionRef.current += 1
    setSelectedResolvers((prev) => {
      const next = new Set(prev)
      if (next.has(ip)) next.delete(ip)
      else next.add(ip)
      return next
    })
  }

  function onModeChange(nextMode: BenchmarkMode) {
    setMode(nextMode)
    setRuns(MODE_RUNS[nextMode])
  }

  function onScoringProfileChange(nextProfile: ScoringProfile) {
    setScoringProfile(nextProfile)
  }

  function handleScopeSelect(scope: TargetScope) {
    scopeSourceRef.current = 'manual'
    setScopeSource('manual')
    selectionVersionRef.current += 1
    setTargetScope(scope)
    setSelectedResolvers(new Set(deriveTargetResolvers(providers, scope, systemDns)))
  }

  function handleScopeReset() {
    scopeSourceRef.current = 'auto'
    setScopeSource('auto')
    selectionVersionRef.current += 1
    setTargetScope('unknown')
    setSelectedResolvers(new Set(deriveTargetResolvers(providers, 'unknown', systemDns)))
  }

  function applyRecommendation() {
    if (!primaryResult) return
    guidedVerification.cancel()
    setGuidedApplyOpen(true)
    setGuidedCopyStatus('idle')
  }

  function handleViewFullRanking() {
    rankingPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleCopyRecommendedDns() {
    if (!picks.primary) return
    try {
      await navigator.clipboard.writeText(picks.primary)
      setCopyStatus('success')
    } catch {
      setCopyStatus('error')
    }
  }

  async function handleGuidedCopy(addresses: string[]) {
    const text = buildDnsClipboardText(addresses)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setGuidedCopyStatus('success')
    } catch {
      setGuidedCopyStatus('error')
    }
  }

  function handleGuidedVerify() {
    if (!primaryResult) return
    void guidedVerification.verify({
      recommendedResolver: primaryResult.resolver,
      systemDns,
    })
  }

  function handleViewSavedRun() {
    if (!savedLastRun) return
    setCopyStatus('idle')
    setSummaryCopyStatus('idle')
    session.viewSavedRun(savedLastRun.payload)
  }

  function handleClearSavedRun() {
    clearSavedLastRun()
    setSavedLastRun(null)
    setSavedRunNotice(null)
  }

  function exportJsonReport() {
    if (!status || status.status !== 'done') return
    triggerDownload(JSON.stringify(status, null, 2), `dnspect-${status.id}.json`, 'application/json')
  }

  async function exportCsvReport() {
    if (!status || status.status !== 'done') return
    const exportId = benchmarkId ?? status.id
    if (exportId) {
      try {
        const response = await fetch(`${API_BASE}/api/benchmarks/${exportId}/export.csv`)
        if (response.ok) {
          const csvBlob = await response.blob()
          triggerDownload(csvBlob, `dnspect-${exportId}.csv`, 'text/csv')
          return
        }
      } catch {
        // Fallback to local CSV generation.
      }
    }
    const csv = buildBenchmarkCsv(status)
    if (!csv) return
    triggerDownload(csv, `dnspect-${status.id}.csv`, 'text/csv')
  }

  async function handleCopySummary() {
    if (!status || status.status !== 'done') return
    try {
      const summary = buildShareSummary({
        status,
        language,
        t,
        recommended: primaryResult,
        currentResolver: currentResolverForSummary,
        improvementMs: improvementVsCurrentMs,
      })
      await navigator.clipboard.writeText(summary)
      setSummaryCopyStatus('success')
    } catch {
      setSummaryCopyStatus('error')
    }
  }

  function handleSelectResult(result: ResolverResult) {
    session.selectResult(result)
  }

  async function handleLoadSamples() {
    await session.loadSamples()
  }

  const isCompleted = status?.status === 'done'
  const reliabilityPct = primaryResult ? resolverReliabilityScore(primaryResult) * 100 : null
  const runningEtaText = useMemo(() => {
    return computeRunningEtaText(status, timeoutSec, (key) => t(key))
  }, [status, t, timeoutSec])
  const detectedPlatformLabel = useMemo(() => {
    const fromSystem = systemDns?.platform?.trim()
    if (fromSystem) return fromSystem
    const fromNavigator = typeof window !== 'undefined' ? window.navigator.platform : ''
    return fromNavigator || t('summary.na')
  }, [systemDns?.platform, t])
  const detectedPlatformGroup = useMemo(() => detectPlatformGroup(detectedPlatformLabel), [detectedPlatformLabel])
  const primaryRank = useMemo(() => {
    if (!primaryResult) return null
    const index = decisiveRanking.findIndex((item) => item.resolver === primaryResult.resolver)
    return index >= 0 ? index + 1 : null
  }, [decisiveRanking, primaryResult])
  const currentDnsEvaluation = useMemo(() => {
    if (!systemDns?.resolvers?.length || decisiveRanking.length === 0) return null
    const detected = decisiveRanking
      .map((row, index) => ({ row, rank: index + 1 }))
      .filter((item) => systemDns.resolvers.includes(item.row.resolver))
    if (detected.length === 0) return null
    return detected[0]
  }, [decisiveRanking, systemDns?.resolvers])
  const improvementVsCurrentMs = useMemo(() => {
    if (!primaryResult || !currentDnsEvaluation) return null
    const currentAverage = currentDnsEvaluation.row.stats.score_latency
    const recommendedAverage = primaryResult.stats.score_latency
    if (currentAverage === null || recommendedAverage === null) return null
    return currentAverage - recommendedAverage
  }, [currentDnsEvaluation, primaryResult])
  const currentAverageVsRecommendation = currentDnsEvaluation?.row.stats.score_latency ?? null
  const isSmallImprovementLabel = isSmallImprovement(improvementVsCurrentMs, currentAverageVsRecommendation)
  const currentResolverLabel = useMemo(() => {
    const resolver = status?.progress.current_resolver
    if (!resolver) return t('summary.na')
    const item = resolverCatalog.get(resolver)
    if (item?.providerName && item.providerName !== t('summary.na')) {
      return t('status.currentResolverNamed', { name: item.providerName, resolver })
    }
    return t('status.currentResolverFallback', { resolver })
  }, [resolverCatalog, status?.progress.current_resolver, t])
  const currentResolverForSummary = useMemo(() => {
    if (currentDnsEvaluation) {
      return `${currentDnsEvaluation.row.provider_name} (${currentDnsEvaluation.row.resolver})`
    }
    const resolver = systemDns?.resolvers?.[0]
    if (!resolver) return t('summary.na')
    const item = resolverCatalog.get(resolver)
    const providerName = item?.providerName ?? t('summary.na')
    return providerName === t('summary.na') ? resolver : `${providerName} (${resolver})`
  }, [currentDnsEvaluation, resolverCatalog, systemDns?.resolvers, t])
  const savedLastRunSummary = useMemo(() => {
    if (!savedLastRun) return null
    const savedPrimary = resolveRecommendedResult(savedLastRun.payload)
    const topResult = savedLastRun.payload.results?.[0] ?? null
    const timestamp = new Date(savedLastRun.metadata.timestamp)
    const timestampLabel = Number.isNaN(timestamp.getTime())
      ? savedLastRun.metadata.timestamp
      : timestamp.toLocaleString(language === 'pt' ? 'pt-BR' : language === 'en' ? 'en-US' : 'es-ES')
    return {
      timestampLabel,
      recommendedLabel: savedPrimary ? `${savedPrimary.provider_name} (${savedPrimary.resolver})` : t('summary.na'),
      topLatency: fmtMs(topResult?.stats.score_latency ?? topResult?.stats.avg_ms ?? null),
      topReliability:
        topResult === null ? t('summary.na') : `${(resolverReliabilityScore(topResult) * 100).toFixed(1)}%`,
    }
  }, [language, savedLastRun, t])

  return (
    <>
      <a href="#main-content" className="skip-link">
        {t('accessibility.skipToContent')}
      </a>
      <div className="app-shell">
      <header className="app-header">
        <div className="app-topbar">
          <div className="app-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="var(--accent)" />
              <path d="M12 8v4l3 3" stroke="var(--accent)" />
              <path d="M5 5l2 2M19 5l-2 2M5 19l2-2M19 19l-2-2" stroke="currentColor" strokeOpacity="0.4" />
            </svg>
            DNSPect
          </div>
          <ModeSwitcher mode={appMode} onChange={setAppMode} />
          <div className="header-actions">
            <button
              className="btn-ghost icon-btn theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={nextThemeLabel}
              title={nextThemeLabel}
            >
              {theme === 'dark' ? (
                <svg className="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="4.3" stroke="currentColor" strokeWidth="1.9" />
                  <path
                    d="M12 2.3V4.4M12 19.6v2.1M4.9 4.9 6.4 6.4M17.6 17.6l1.5 1.5M2.3 12h2.1M19.6 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg className="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M20.4 14.4a8.7 8.7 0 1 1-10.8-10.8 7.4 7.4 0 1 0 10.8 10.8Z"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <LocaleMenu language={language} onLanguageChange={setLanguage} />
          </div>
        </div>

        {(() => {
          const stripState =
            status === null ? 'idle' : isRunning ? 'running' : status.status === 'done' ? 'complete' : status.status === 'failed' || status.status === 'cancelled' ? 'failed' : 'idle'
          const stripLabel =
            stripState === 'idle'
              ? t('status.idle')
              : stripState === 'running'
                ? t('status.measuring')
                : stripState === 'complete'
                  ? t('status.complete')
                  : t('status.failed')
          const stripPct = stripState === 'complete' ? 100 : progressPct
          const stripEta =
            stripState === 'running'
              ? runningTimeRemaining !== null
                ? formatRemainingTime(runningTimeRemaining)
                : runningEtaText ?? t('status.etaUnavailable')
              : null
          return (
            <div className="status-strip" data-state={stripState} role="status" aria-live="polite">
              <span className="status-dot" aria-hidden="true" />
              <span className="status-label">{stripLabel}</span>
              <span className="status-progress" aria-hidden="true">
                <span style={{ width: `${stripPct}%` }} />
              </span>
              <span className="status-meta">
                {stripState === 'running' && stripEta
                  ? `${stripPct}% · ${t('status.etaValue', { eta: stripEta })}`
                  : stripState === 'complete'
                    ? '100%'
                    : ''}
              </span>
            </div>
          )
        })()}

        {isInitializing ? (
          <div className="hero" style={{ display: 'grid', gap: 'var(--space-3)' }} aria-busy="true" aria-label={t('accessibility.loading')}>
            <span className="skeleton skeleton-heading" style={{ width: '28%' }} />
            <span className="skeleton skeleton-text" style={{ width: '48%' }} />
          </div>
        ) : (
          <div className="hero">
            <svg className="hero-decoration" viewBox="0 0 400 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              <path d="M30 80 L90 30 L170 50 L250 20 L340 55" stroke="var(--accent)" strokeWidth="1" opacity="0.12" fill="none" />
              <path d="M30 80 L60 110 L140 90 L210 115 L340 55" stroke="var(--accent)" strokeWidth="1" opacity="0.08" fill="none" />
              <path d="M90 30 L170 50 L210 115 L250 20" stroke="var(--accent)" strokeWidth="0.6" opacity="0.07" fill="none" />
              <circle cx="30" cy="80" r="3" fill="var(--accent)" opacity="0.2" />
              <circle cx="90" cy="30" r="4" fill="var(--accent)" opacity="0.25" />
              <circle cx="170" cy="50" r="2.5" fill="var(--accent)" opacity="0.2" />
              <circle cx="250" cy="20" r="3.5" fill="var(--accent)" opacity="0.22" />
              <circle cx="340" cy="55" r="3" fill="var(--accent)" opacity="0.18" />
              <circle cx="60" cy="110" r="2" fill="var(--accent)" opacity="0.15" />
              <circle cx="140" cy="90" r="3" fill="var(--accent)" opacity="0.18" />
              <circle cx="210" cy="115" r="2.5" fill="var(--accent)" opacity="0.2" />
            </svg>
            <div className="hero-content">
              <h1>{t('app.title')}</h1>
              <p>{t('app.subtitle')}</p>
            </div>
            <div className="hero-meta">
              <span className="hero-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />
                </svg>
                {t(regionLabelKey(targetScope))}
              </span>
              <span className="hero-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                  <rect x="2" y="2" width="20" height="8" rx="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" />
                </svg>
                {t('app.xProviders', { count: regionFilteredProviders.length })}
              </span>
              {systemDns?.resolvers?.length ? (
                <span className="hero-meta-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <path d="M22 4 12 14.01l-3-3" />
                  </svg>
                  {t('app.xSystemDns', { count: systemDns.resolvers.length })}
                </span>
              ) : null}
            </div>
            <details className="preview-collapse">
              <summary>{t('app.previewTitle')}</summary>
              <p>{t('app.previewLine1')}</p>
              <p>{t('app.previewLine2')}</p>
            </details>
          </div>
        )}
      </header>

      <main id="main-content" tabIndex={-1}>
      {isInitializing ? (
        <section className="card" style={{ display: 'grid', gap: 'var(--space-4)' }} aria-busy="true" aria-label={t('accessibility.loading')}>
          <span className="skeleton skeleton-heading" style={{ width: '30%' }} />
          <span className="skeleton skeleton-text" style={{ width: '50%' }} />
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <span className="skeleton skeleton-chip" />
            <span className="skeleton skeleton-chip" />
            <span className="skeleton skeleton-chip" />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <span className="skeleton skeleton-chip" style={{ width: '120px' }} />
            <span className="skeleton skeleton-chip" style={{ width: '120px' }} />
            <span className="skeleton skeleton-chip" style={{ width: '120px' }} />
          </div>
          <span className="skeleton skeleton-btn" />
          <span className="skeleton skeleton-text" style={{ width: '40%' }} />
        </section>
      ) : appMode === 'quick' ? (
        <QuickCheckPanel
          status={status}
          error={error}
          systemDns={systemDns}
          resolverCount={quickResolvers.length}
          onStart={handleQuickStart}
          onApply={applyRecommendation}
          onOpenLab={() => setAppMode('lab')}
        />
      ) : (
        <LabWorkspace
          initialSection={status?.status === 'done' ? 'results' : 'benchmark'}
          controls={{
            providers: regionFilteredProviders,
            selected: selectedResolvers,
            mode,
            protocol,
            scoringProfile,
            runs,
            timeoutSec,
            timeoutPreset,
            queriesText,
            systemResolvers: systemDns?.resolvers ?? [],
            isRunning,
            advancedOpen,
            workloadSummary: workloadMetrics.summary,
            startHelperText: startCtaHelpText,
            scope: targetScope,
            scopeSource,
            onScopeSelect: handleScopeSelect,
            onScopeReset: handleScopeReset,
            onToggleResolver: toggleResolver,
            onModeChange,
            onProtocolChange: setProtocol,
            onScoringProfileChange,
            onRunsChange: (v) => setRuns(Math.max(1, Math.min(300, Number.isFinite(v) ? v : runs))),
            onTimeoutChange: (v) => setTimeoutSec(Math.max(0.2, Math.min(10, Number.isFinite(v) ? v : timeoutSec))),
            onTimeoutPresetChange: (preset) => {
              setTimeoutPreset(preset)
              setTimeoutSec(BASIC_TIMEOUT_PRESET[preset])
            },
            onQueriesTextChange: setQueriesText,
            onToggleAdvanced: () => setAdvancedOpen((prev) => !prev),
            onShowResolverList: () => setResolverListOpen(true),
            onStart: () => {
              void handleStart()
            },
            comparisonOpen,
            comparisonProtocols,
            comparisonPreflight,
            comparisonPreflightLoading,
            comparisonPreflightError,
            comparisonActive: protocolComparisonActive,
            onToggleComparison: handleToggleComparison,
            onToggleComparisonProtocol: handleToggleComparisonProtocol,
            onStartComparison: handleStartComparison,
            doqAvailable,
          }}
          doqAvailable={doqAvailable}
          runningCard={
            isRunning
              ? {
                  healthMessage: runningHealthMessage,
                  progressPct,
                  completedResolvers: progressCompletedResolvers,
                  totalResolvers: progressTotalResolvers,
                  currentResolverLabel,
                  lastProgressLabel,
                  avgLatencyMs: measuredAvgLatencyMs,
                  etaLabel:
                    runningTimeRemaining !== null
                      ? formatRemainingTime(runningTimeRemaining)
                      : runningEtaText ?? t('status.etaUnavailable'),
                  results: status?.results ?? [],
                  runs: status?.runs ?? 0,
                  currentResolver: status?.progress.current_resolver ?? null,
                  isRunning: status?.status === 'running',
                }
              : null
          }
          failedError={
            status?.status === 'failed' || status?.status === 'cancelled'
              ? (status?.error ?? t('status.pending'))
              : null
          }
          systemDns={systemDns}
          saved={{
            lastRunSummary: savedLastRunSummary,
            notice: savedRunNotice,
            viewingSavedRun,
            onViewSavedRun: handleViewSavedRun,
            onClearSavedRun: handleClearSavedRun,
          }}
          results={{
            isCompleted,
            primaryResult,
            decisiveRanking,
            reliabilityPct,
            improvementVsCurrentMs,
            currentResolverLabel: currentResolverForSummary,
            currentResolverRank: currentDnsEvaluation?.rank ?? null,
            recommendationWarning: status?.recommendation_warning ?? null,
            isSmallImprovement: isSmallImprovementLabel,
            showRecommendedPanel: recommendationRun !== null,
            viewingWatchRun,
            runOrigin: status?.origin ?? null,
            primaryRank,
            copyStatus,
            summaryCopyStatus,
            rankingPanelRef,
            emptyMessage: t('noRanking.text'),
            onSelectResult: handleSelectResult,
            onApplyRecommended: applyRecommendation,
            onCopyAddress: () => void handleCopyRecommendedDns(),
            onCopySummary: () => void handleCopySummary(),
            onExportJson: exportJsonReport,
            onExportCsv: () => void exportCsvReport(),
            onViewFullRanking: handleViewFullRanking,
            searchTerm,
            onlyReliable,
            isRunning,
            onSearchChange: setSearchTerm,
            onOnlyReliableChange: setOnlyReliable,
            filteredResults,
            currentDnsEvaluation,
            recommendedProviderName: primaryResult?.provider_name ?? t('summary.na'),
          }}
          history={{
            runs: history,
            loading: historyLoading,
            baselineId: comparisonBaselineId,
            candidateId: comparisonCandidateId,
            comparison: comparisonData,
            comparisonLoading,
            comparisonError,
            onSelectRun: (runId) => void handleSelectRun(runId),
            onSetBaseline: (runId) => selectComparisonPair(runId, comparisonCandidateId),
            onSetCandidate: (runId) => selectComparisonPair(comparisonBaselineId, runId),
            onClearComparison: clearComparison,
          }}
          watch={{
            currentSession: watchSessionConfig,
            onCompare: (baselineId, candidateId) => selectComparisonPair(baselineId, candidateId),
          }}
          protocol={{
            comparisonId: protocolComparisonId,
            comparison: protocolComparisonData,
            loading: protocolComparisonLoading,
            error: protocolComparisonError,
          }}
        />
      )}

      {error && (
        <section className="error-box" role="alert">
          <p>
            <strong>{t('error.title')}</strong> {error}
          </p>
          <ul className="hint-list">
            <li>{t('error.hint1')}</li>
            <li>{t('error.hint2')}</li>
            <li>{t('error.hint3')}</li>
          </ul>
        </section>
      )}

      <GuidedApplyModal
        open={guidedApplyOpen && Boolean(primaryResult)}
        onClose={() => {
          guidedVerification.cancel()
          setGuidedApplyOpen(false)
        }}
        detectedPlatformLabel={detectedPlatformLabel}
        detectedPlatformGroup={detectedPlatformGroup}
        resolverName={primaryResult?.provider_name ?? t('summary.na')}
        recommendedPrimary={primaryResult?.resolver ?? null}
        recommendedSecondary={picks.secondary ?? null}
        ipv4Dns={guidedDnsSet.ipv4}
        ipv6Dns={guidedDnsSet.ipv6}
        allDns={guidedDnsSet.all}
        copyStatus={guidedCopyStatus}
        isVerifying={guidedVerification.isVerifying}
        verifyError={guidedVerification.verifyError}
        verification={guidedVerification.verification}
        onCopyIpv4={() => void handleGuidedCopy(guidedDnsSet.ipv4)}
        onCopyIpv6={() => void handleGuidedCopy(guidedDnsSet.ipv6)}
        onCopyAll={() => void handleGuidedCopy(guidedDnsSet.all)}
        onVerify={() => {
          void handleGuidedVerify()
        }}
      />

      {resolverListOpen && (
        <div ref={resolverListRef} className="modal-backdrop" onClick={() => setResolverListOpen(false)} role="dialog" aria-modal="true" aria-label={t('resolverModal.subtitle')}>
          <div className="modal resolver-list-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{t('resolverModal.title', { count: selectedResolverCatalog.length })}</h3>
              <button type="button" onClick={() => setResolverListOpen(false)}>
                {t('modal.close')}
              </button>
            </div>
            <p className="muted">{t('resolverModal.subtitle')}</p>
            <ul className="resolver-modal-list">
              {selectedResolverCatalog.map((item) => (
                <li key={item.resolver}>
                  <span>{item.providerName}</span>
                  <code>{item.resolver}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {selectedResult && (
        <Suspense fallback={null}>
          <ResolverDetailModal
          result={selectedResult}
          provider={providers.find((p) => p.id === selectedResult.provider_id)}
          isLoadingSamples={loadingSamples}
          canLoadSamples={Boolean(benchmarkId) && selectedResult.samples.length === 0}
          doqAvailable={doqAvailable}
          onLoadSamples={() => {
            void handleLoadSamples()
          }}
          onClose={() => {
            session.selectResult(null)
          }}
        />
      </Suspense>
      )}
      </main>
      </div>
    </>
  )
}

export default App
