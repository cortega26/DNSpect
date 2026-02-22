import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { ChartsPanel } from '@/components/ChartsPanel'
import { DashboardControls, type TimeoutPreset } from '@/components/DashboardControls'
import { LiveRankingPanel } from '@/components/LiveRankingPanel'
import { RecommendedResolverPanel } from '@/components/RecommendedResolverPanel'
import { ResolverDetailModal } from '@/components/ResolverDetailModal'
import { ResolverRankingPanel } from '@/components/ResolverRankingPanel'
import { useI18n, type Language } from '@/lib/i18n'
import { computeRunningEtaText, formatEtaRange } from '@/lib/eta'
import { getBenchmark, getProviders, getSystemDns, startBenchmark } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import type { BenchmarkMode, BenchmarkStatus, Provider, ResolverResult, SystemDnsPayload } from '@/lib/types'
import { API_BASE, fmtMs, resolverReliabilityScore } from '@/lib/utils'

const MODE_RUNS: Record<BenchmarkMode, number> = {
  quick: 12,
  standard: 30,
  exhaustive: 80,
}

const BASIC_TIMEOUT_PRESET: Record<TimeoutPreset, number> = {
  low: 1.5,
  medium: 2,
  high: 3,
}

const POLL_INTERVAL_MS = 1000
const STALL_SLOW_THRESHOLD_MS = 4000
const STALL_HARD_THRESHOLD_MS = 8000

interface ResolverCatalogItem {
  resolver: string
  providerName: string
}

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

const languageOptions: Array<{ value: Language; flag: string; code: string; srLabel: string }> = [
  { value: 'es', flag: '🇪🇸', code: 'ES', srLabel: 'Español' },
  { value: 'en', flag: '🇺🇸', code: 'EN', srLabel: 'English' },
  { value: 'pt', flag: '🇧🇷', code: 'PT', srLabel: 'Português' },
]

function App() {
  const { language, setLanguage, t } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const nextThemeLabel = theme === 'dark' ? t('header.themeToggleToLight') : t('header.themeToggleToDark')

  const [providers, setProviders] = useState<Provider[]>([])
  const [systemDns, setSystemDns] = useState<SystemDnsPayload | null>(null)
  const [selectedResolvers, setSelectedResolvers] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<BenchmarkMode>('standard')
  const [runs, setRuns] = useState<number>(MODE_RUNS.standard)
  const [timeoutSec, setTimeoutSec] = useState<number>(2)
  const [timeoutPreset, setTimeoutPreset] = useState<TimeoutPreset>('medium')
  const [queriesText, setQueriesText] = useState<string>('')
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false)

  const [benchmarkId, setBenchmarkId] = useState<string | null>(null)
  const [status, setStatus] = useState<BenchmarkStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedResult, setSelectedResult] = useState<ResolverResult | null>(null)
  const [loadingSamples, setLoadingSamples] = useState<boolean>(false)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [onlyReliable, setOnlyReliable] = useState<boolean>(false)
  const [resolverListOpen, setResolverListOpen] = useState<boolean>(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [localeMenuOpen, setLocaleMenuOpen] = useState<boolean>(false)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const applyGuideRef = useRef<HTMLElement | null>(null)
  const rankingPanelRef = useRef<HTMLElement | null>(null)
  const localeMenuRef = useRef<HTMLDivElement>(null)
  const localeTriggerRef = useRef<HTMLButtonElement>(null)
  const localeOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pollTimerRef = useRef<number | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const pollInFlightRef = useRef<boolean>(false)
  const activePollBenchmarkIdRef = useRef<string | null>(null)

  useEffect(() => {
    async function init() {
      try {
        const [providersRes, dnsRes] = await Promise.all([getProviders(), getSystemDns()])
        setProviders(providersRes)
        setSystemDns(dnsRes)

        const defaults = new Set<string>()
        providersRes.forEach((p) => p.dns.forEach((ip) => defaults.add(ip)))
        dnsRes.resolvers.forEach((ip) => defaults.add(ip))
        setSelectedResolvers(defaults)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error cargando datos iniciales')
      }
    }
    void init()
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (pollAbortRef.current) {
      pollAbortRef.current.abort()
      pollAbortRef.current = null
    }
    pollInFlightRef.current = false
    activePollBenchmarkIdRef.current = null
  }, [])

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      activePollBenchmarkIdRef.current = id
      let cancelled = false

      const scheduleNext = (delayMs: number) => {
        if (cancelled || activePollBenchmarkIdRef.current !== id) return
        pollTimerRef.current = window.setTimeout(() => {
          void pollOnce()
        }, delayMs)
      }

      const pollOnce = async () => {
        if (cancelled || activePollBenchmarkIdRef.current !== id) return
        if (pollInFlightRef.current) {
          scheduleNext(120)
          return
        }

        pollInFlightRef.current = true
        const controller = new AbortController()
        pollAbortRef.current = controller

        try {
          const next = await getBenchmark(id, false, controller.signal)
          if (cancelled || activePollBenchmarkIdRef.current !== id) return
          setStatus(next)
          if (next.status === 'running') {
            scheduleNext(POLL_INTERVAL_MS)
          } else {
            stopPolling()
          }
        } catch (e) {
          if (controller.signal.aborted || cancelled || activePollBenchmarkIdRef.current !== id) return
          setError(e instanceof Error ? e.message : t('error.benchmarkPoll'))
          stopPolling()
        } finally {
          pollInFlightRef.current = false
          if (pollAbortRef.current === controller) {
            pollAbortRef.current = null
          }
        }
      }

      void pollOnce()

      return () => {
        cancelled = true
        if (activePollBenchmarkIdRef.current === id) {
          stopPolling()
        }
      }
    },
    [stopPolling, t],
  )

  useEffect(() => {
    if (!benchmarkId) {
      stopPolling()
      return
    }
    return startPolling(benchmarkId)
  }, [benchmarkId, startPolling, stopPolling])

  useEffect(() => {
    setTimeoutPreset(nearestTimeoutPreset(timeoutSec))
  }, [timeoutSec])

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const resolverCatalog = useMemo(() => {
    const catalog = new Map<string, ResolverCatalogItem>()
    providers.forEach((provider) => {
      provider.dns.forEach((ip) => {
        catalog.set(ip, {
          resolver: ip,
          providerName: provider.name,
        })
      })
    })
    ;(systemDns?.resolvers ?? []).forEach((resolver) => {
      if (!catalog.has(resolver)) {
        catalog.set(resolver, {
          resolver,
          providerName: t('group.isp'),
        })
      }
    })
    return catalog
  }, [providers, systemDns?.resolvers, t])
  const selectedResolverCatalog = useMemo(
    () =>
      Array.from(selectedResolvers)
        .map((resolver) => resolverCatalog.get(resolver) ?? { resolver, providerName: t('summary.na') })
        .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.resolver.localeCompare(b.resolver)),
    [resolverCatalog, selectedResolvers, t],
  )

  const decisiveRanking = status?.results ?? []
  const sortedResults = decisiveRanking
  const picks = useMemo(
    () => ({
      primary: decisiveRanking[0]?.resolver,
      secondary: decisiveRanking[1]?.resolver,
    }),
    [decisiveRanking],
  )
  const primaryResult = useMemo(
    () => decisiveRanking.find((row) => row.resolver === picks.primary) ?? null,
    [decisiveRanking, picks.primary],
  )

  const filteredResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return sortedResults.filter((row) => {
      const tags = providerById.get(row.provider_id)?.tags ?? []
      const searchable = `${row.resolver} ${row.provider_name} ${tags.join(' ')}`.toLowerCase()
      const matchesSearch = term.length === 0 || searchable.includes(term)
      const matchesReliable = !onlyReliable || row.stats.failure_rate <= 0.2
      return matchesSearch && matchesReliable
    })
  }, [onlyReliable, providerById, searchTerm, sortedResults])
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

  const isRunning = status?.status === 'running'
  const progressPct = status?.progress.total
    ? Math.min(100, Math.max(0, Math.round((status.progress.current / status.progress.total) * 100)))
    : 0
  const lastSampleAtMs = useMemo(() => parseTimestampMs(status?.progress.last_sample_at), [status?.progress.last_sample_at])
  const lastProgressAgeMs = useMemo(() => {
    if (!isRunning || lastSampleAtMs === null) return null
    return Math.max(0, nowMs - lastSampleAtMs)
  }, [isRunning, lastSampleAtMs, nowMs])
  const runningHealthMessage = useMemo(() => {
    if (!isRunning) return t('status.runningHealthNormal')
    if (lastProgressAgeMs === null || lastProgressAgeMs <= STALL_SLOW_THRESHOLD_MS) {
      return t('status.runningHealthNormal')
    }
    if (lastProgressAgeMs <= STALL_HARD_THRESHOLD_MS) {
      return t('status.runningHealthSlow')
    }
    return t('status.runningHealthStalled')
  }, [isRunning, lastProgressAgeMs, t])
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
  const activeLanguage = useMemo(
    () => languageOptions.find((option) => option.value === language) ?? languageOptions[0],
    [language],
  )
  const activeLanguageIndex = useMemo(
    () => Math.max(0, languageOptions.findIndex((option) => option.value === language)),
    [language],
  )

  useEffect(() => {
    if (!isRunning) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])

  useEffect(() => {
    if (!localeMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (localeMenuRef.current && !localeMenuRef.current.contains(event.target as Node)) {
        setLocaleMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setLocaleMenuOpen(false)
      localeTriggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [localeMenuOpen])

  useEffect(() => {
    if (copyStatus !== 'success') return
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  function closeLocaleMenu(restoreTriggerFocus = false) {
    setLocaleMenuOpen(false)
    if (restoreTriggerFocus) {
      requestAnimationFrame(() => {
        localeTriggerRef.current?.focus()
      })
    }
  }

  function focusLocaleOption(index: number) {
    if (languageOptions.length === 0) return
    const safeIndex = (index + languageOptions.length) % languageOptions.length
    localeOptionRefs.current[safeIndex]?.focus()
  }

  function openLocaleMenuAndFocus(index = activeLanguageIndex) {
    setLocaleMenuOpen(true)
    requestAnimationFrame(() => {
      focusLocaleOption(index)
    })
  }

  function onLocaleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (event.key === 'ArrowUp') {
        openLocaleMenuAndFocus(languageOptions.length - 1)
      } else {
        openLocaleMenuAndFocus(activeLanguageIndex)
      }
      return
    }

    if (event.key === 'Escape' && localeMenuOpen) {
      event.preventDefault()
      closeLocaleMenu(true)
    }
  }

  function onLocaleItemKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusLocaleOption(index + 1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusLocaleOption(index - 1)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      focusLocaleOption(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      focusLocaleOption(languageOptions.length - 1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeLocaleMenu(true)
      return
    }

    if (event.key === 'Tab') {
      setLocaleMenuOpen(false)
    }
  }

  async function handleStart() {
    setError(null)
    setSelectedResult(null)
    setCopyStatus('idle')
    try {
      const customQueries = parseQueries(queriesText)
      const payload = {
        mode,
        runs,
        timeout_sec: timeoutSec,
        resolvers: Array.from(selectedResolvers),
        ...(customQueries.length > 0 ? { queries: customQueries } : {}),
      }
      const response = await startBenchmark(payload)
      setStatus(null)
      setBenchmarkId(response.benchmark_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.benchmarkStart'))
    }
  }

  function toggleResolver(ip: string) {
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

  function applyRecommendation() {
    const toApply = [picks.primary, picks.secondary].filter(Boolean) as string[]
    if (toApply.length === 0) return
    setSelectedResolvers(new Set(toApply))
    setAdvancedOpen(false)
    applyGuideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  function handleSelectResult(result: ResolverResult) {
    setSelectedResult(result)
  }

  async function handleLoadSamples() {
    if (!benchmarkId || !selectedResult || selectedResult.samples.length > 0 || loadingSamples) return
    setLoadingSamples(true)
    try {
      const full = await getBenchmark(benchmarkId, true)
      const resolved = full.results?.find((row) => row.resolver === selectedResult.resolver)
      if (resolved) {
        setSelectedResult(resolved)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.samples'))
    } finally {
      setLoadingSamples(false)
    }
  }

  const isCompleted = status?.status === 'done'
  const hasResults = isCompleted
  const recommendationAvailable = Boolean(primaryResult)
  const reliabilityPct = primaryResult ? resolverReliabilityScore(primaryResult) * 100 : null
  const runningEtaText = useMemo(() => {
    return computeRunningEtaText(status, timeoutSec, (key) => t(key))
  }, [status, t, timeoutSec])
  const detectedPlatformGroup = useMemo<'windows' | 'macos' | 'linux' | null>(() => {
    const platform = systemDns?.platform?.toLowerCase() ?? ''
    if (platform.includes('win')) return 'windows'
    if (platform.includes('mac') || platform.includes('darwin') || platform.includes('osx')) return 'macos'
    if (platform.includes('linux')) return 'linux'
    return null
  }, [systemDns?.platform])
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
  const currentResolverLabel = useMemo(() => {
    const resolver = status?.progress.current_resolver
    if (!resolver) return t('summary.na')
    const item = resolverCatalog.get(resolver)
    if (item?.providerName && item.providerName !== t('summary.na')) {
      return t('status.currentResolverNamed', { name: item.providerName, resolver })
    }
    return t('status.currentResolverFallback', { resolver })
  }, [resolverCatalog, status?.progress.current_resolver, t])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="hero">
          <h1>{t('app.title')}</h1>
          <p>{t('app.subtitle')}</p>
          <details className="preview-collapse">
            <summary>{t('app.previewTitle')}</summary>
            <p>{t('app.previewLine1')}</p>
            <p>{t('app.previewLine2')}</p>
          </details>
        </div>

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
          <div className="locale-menu" ref={localeMenuRef}>
            <button
              ref={localeTriggerRef}
              className={`select-inline locale-trigger${localeMenuOpen ? ' is-open' : ''}`}
              type="button"
              aria-label={`${t('header.language')}: ${activeLanguage.srLabel}`}
              aria-haspopup="menu"
              aria-controls="locale-menu-options"
              aria-expanded={localeMenuOpen}
              onClick={() => setLocaleMenuOpen((prev) => !prev)}
              onKeyDown={onLocaleTriggerKeyDown}
            >
              <span className="locale-current" aria-hidden="true">
                {activeLanguage.flag} {activeLanguage.code}
              </span>
              <span className="select-caret" aria-hidden="true">
                ▾
              </span>
            </button>

            {localeMenuOpen ? (
              <div id="locale-menu-options" className="locale-dropdown" role="menu" aria-label={t('header.language')}>
                {languageOptions.map((option, index) => {
                  const selected = option.value === language
                  return (
                    <button
                      key={option.value}
                      ref={(el) => {
                        localeOptionRefs.current[index] = el
                      }}
                      className={`locale-item${selected ? ' is-active' : ''}`}
                      type="button"
                      role="menuitemradio"
                      aria-label={option.srLabel}
                      aria-checked={selected}
                      onKeyDown={(event) => onLocaleItemKeyDown(event, index)}
                      onClick={() => {
                        setLanguage(option.value)
                        closeLocaleMenu(true)
                      }}
                    >
                      <span>{option.flag} {option.code}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <DashboardControls
        providers={providers}
        selected={selectedResolvers}
        mode={mode}
        runs={runs}
        timeoutSec={timeoutSec}
        timeoutPreset={timeoutPreset}
        queriesText={queriesText}
        systemResolvers={systemDns?.resolvers ?? []}
        isRunning={isRunning}
        advancedOpen={advancedOpen}
        workloadSummary={workloadMetrics.summary}
        startHelperText={startCtaHelpText}
        onToggleResolver={toggleResolver}
        onModeChange={onModeChange}
        onRunsChange={(v) => setRuns(Math.max(1, Math.min(300, Number.isFinite(v) ? v : runs)))}
        onTimeoutChange={(v) => setTimeoutSec(Math.max(0.2, Math.min(10, Number.isFinite(v) ? v : timeoutSec)))}
        onTimeoutPresetChange={(preset) => {
          setTimeoutPreset(preset)
          setTimeoutSec(BASIC_TIMEOUT_PRESET[preset])
        }}
        onQueriesTextChange={setQueriesText}
        onToggleAdvanced={() => setAdvancedOpen((prev) => !prev)}
        onShowResolverList={() => setResolverListOpen(true)}
        onStart={() => {
          void handleStart()
        }}
      />

      {status?.status === 'running' && (
        <section className="card compact status-running">
          <h3>{t('status.progressPanelTitle')}</h3>
          <p className="muted">{runningHealthMessage}</p>
          <div className="progress-panel progress-panel--live">
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="progress-percent">{progressPct}%</p>
            <div className="progress-metrics">
              <p>{t('status.resolversTested', { tested: progressCompletedResolvers, total: progressTotalResolvers })}</p>
              <p className="progress-current-resolver">
                <span className="progress-current-dot" aria-hidden="true" />
                {currentResolverLabel}
              </p>
              <p>{lastProgressLabel}</p>
              <p>{t('status.avgLatencyContext', { latency: fmtMs(measuredAvgLatencyMs) })}</p>
              <p>
                {t('status.etaRemaining', {
                  eta:
                    runningTimeRemaining !== null
                      ? formatRemainingTime(runningTimeRemaining)
                      : runningEtaText ?? t('status.etaUnavailable'),
                })}
              </p>
            </div>
          </div>
          <LiveRankingPanel
            results={status.results ?? []}
            expectedSamples={status.runs}
            isRunning={status.status === 'running'}
            currentResolver={status.progress.current_resolver}
          />
        </section>
      )}

      {status?.status === 'error' && (
        <section className="card compact status-error">
          <h3>{t('status.errorTitle')}</h3>
          <p>{t('status.errorHint', { error: status.error ?? t('status.pending') })}</p>
        </section>
      )}

      {isCompleted && recommendationAvailable && primaryResult && (
        <RecommendedResolverPanel
          result={primaryResult}
          rank={primaryRank ?? 1}
          reliabilityPct={reliabilityPct}
          improvementVsCurrentMs={improvementVsCurrentMs}
          copyStatus={copyStatus}
          onApplyRecommended={applyRecommendation}
          onCopyAddress={() => void handleCopyRecommendedDns()}
          onViewFullRanking={handleViewFullRanking}
        />
      )}

      {isCompleted && (
        <div
          ref={(element) => {
            rankingPanelRef.current = element
          }}
        >
          <ResolverRankingPanel
            id="resolver-ranking-panel"
            results={decisiveRanking}
            emptyMessage={t('noRanking.text')}
            onSelect={handleSelectResult}
          />
        </div>
      )}

      {systemDns && (
        <section className="card compact">
          <h3>{t('systemDns.title')}</h3>
          <p>
            {t('systemDns.method')}: <strong>{systemDns.method}</strong> | {t('systemDns.platform')}:{' '}
            <strong>{systemDns.platform}</strong>
          </p>
          <p>{systemDns.resolvers.length ? systemDns.resolvers.join(', ') : t('systemDns.none')}</p>
        </section>
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

      {hasResults && sortedResults.length > 0 && (
        <>
          <section className="card compact">
            <h3>{t('systemDns.evaluationTitle')}</h3>
            {currentDnsEvaluation ? (
                <>
                <p className="recommendation-ip">{currentDnsEvaluation.row.resolver}</p>
                <p>{t('systemDns.evaluationLatency', { latency: fmtMs(currentDnsEvaluation.row.stats.score_latency) })}</p>
                <p>{t('systemDns.evaluationRank', { rank: currentDnsEvaluation.rank })}</p>
                <p>
                  {t('systemDns.evaluationRecommendation', {
                    provider: primaryResult?.provider_name ?? t('summary.na'),
                    resolver: primaryResult?.resolver ?? t('summary.na'),
                  })}
                </p>
              </>
            ) : (
              <p>{t('systemDns.evaluationUnavailable')}</p>
            )}
          </section>

          {recommendationAvailable && (
            <section ref={applyGuideRef} className="card compact system-guide">
              <h3>{t('applyGuide.title')}</h3>
              <p>{t('applyGuide.lead')}</p>
              {systemDns?.platform ? (
                <p className="muted">{t('applyGuide.detectedPlatform', { platform: systemDns.platform })}</p>
              ) : null}

              <details className="guide-platform" open={detectedPlatformGroup === 'windows' || detectedPlatformGroup === null}>
                <summary>{t('applyGuide.windowsTitle')}</summary>
                <ol className="guide-steps">
                  <li>{t('applyGuide.windowsStep1')}</li>
                  <li>{t('applyGuide.windowsStep2')}</li>
                  <li>{t('applyGuide.windowsStep3')}</li>
                </ol>
              </details>

              <details className="guide-platform" open={detectedPlatformGroup === 'macos'}>
                <summary>{t('applyGuide.macosTitle')}</summary>
                <ol className="guide-steps">
                  <li>{t('applyGuide.macosStep1')}</li>
                  <li>{t('applyGuide.macosStep2')}</li>
                  <li>{t('applyGuide.macosStep3')}</li>
                </ol>
              </details>

              <details className="guide-platform" open={detectedPlatformGroup === 'linux'}>
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
          )}

          <section className="card compact">
            <h3>{t('summary.title')}</h3>
            <div className="summary-grid">
              <article className="metric-card" title="Rendimiento de mediana (ms)">
                <h4>{t('summary.fast')}</h4>
                <p>{fmtMs(primaryResult?.stats.median_ms ?? null)}</p>
              </article>
              <article className="metric-card" title="Estabilidad p95 (ms)">
                <h4>{t('summary.stable')}</h4>
                <p>{fmtMs(primaryResult?.stats.p95_ms ?? null)}</p>
              </article>
              <article className="metric-card" title="Confiabilidad = 1 - failure_rate">
                <h4>{t('summary.reliable')}</h4>
                <p>{reliabilityPct === null ? t('summary.na') : `${reliabilityPct.toFixed(0)}%`}</p>
              </article>
            </div>
          </section>

          <section className="card compact">
            <h3>{t('guide.title')}</h3>
            <p>{t('guide.line1')}</p>
            <p>{t('guide.line2')}</p>
          </section>

          <section className="card compact">
            <h3>{t('filters.title')}</h3>
            <div className="filters-grid">
              <label>
                {t('filters.searchLabel')}
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('filters.searchPlaceholder')}
                  disabled={isRunning}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={onlyReliable}
                  disabled={isRunning}
                  onChange={(e) => setOnlyReliable(e.target.checked)}
                />
                {t('filters.onlyReliable')}
              </label>
            </div>
          </section>

          <ChartsPanel results={filteredResults} />

          <section className="card compact">
            <h3>{t('exports.title')}</h3>
            <div className="actions-row export-actions">
              <div className="export-action">
                <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.csv`}>
                  {t('exports.csv')}
                </a>
                <p className="helper-text export-help">{t('exports.csvPurpose')}</p>
              </div>
              <div className="export-action">
                <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json`}>
                  {t('exports.jsonSummary')}
                </a>
                <p className="helper-text export-help">{t('exports.jsonSummaryPurpose')}</p>
              </div>
              <div className="export-action">
                <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json?include_samples=1`}>
                  {t('exports.jsonSamples')}
                </a>
                <p className="helper-text export-help">{t('exports.jsonSamplesPurpose')}</p>
              </div>
            </div>
          </section>
        </>
      )}

      {resolverListOpen && (
        <div className="modal-backdrop" onClick={() => setResolverListOpen(false)}>
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
        <ResolverDetailModal
          result={selectedResult}
          provider={providers.find((p) => p.id === selectedResult.provider_id)}
          isLoadingSamples={loadingSamples}
          canLoadSamples={Boolean(benchmarkId) && selectedResult.samples.length === 0}
          onLoadSamples={() => {
            void handleLoadSamples()
          }}
          onClose={() => {
            setSelectedResult(null)
            setLoadingSamples(false)
          }}
        />
      )}
    </div>
  )
}

export default App
