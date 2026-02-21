import { useEffect, useMemo, useRef, useState } from 'react'

import { ChartsPanel } from '@/components/ChartsPanel'
import { DashboardControls, type TimeoutPreset } from '@/components/DashboardControls'
import { ResolverDetailModal } from '@/components/ResolverDetailModal'
import { ResultsTable } from '@/components/ResultsTable'
import { useI18n, type Language } from '@/lib/i18n'
import { getBenchmark, getProviders, getSystemDns, startBenchmark } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import type { BenchmarkMode, BenchmarkStatus, Provider, ResolverResult, SystemDnsPayload } from '@/lib/types'
import { API_BASE, fmtMs, recommendations, sortRanking } from '@/lib/utils'

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

const languageOptions: Array<{ value: Language; flag: string; code: string }> = [
  { value: 'es', flag: '🇪🇸', code: 'ES' },
  { value: 'en', flag: '🇺🇸', code: 'EN' },
  { value: 'pt', flag: '🇧🇷', code: 'PT' },
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
  const [naLast, setNaLast] = useState<boolean>(true)
  const [localeMenuOpen, setLocaleMenuOpen] = useState<boolean>(false)
  const localeMenuRef = useRef<HTMLDivElement>(null)
  const localeTriggerRef = useRef<HTMLButtonElement>(null)

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

  useEffect(() => {
    if (!benchmarkId) return
    const timer = setInterval(async () => {
      try {
        const next = await getBenchmark(benchmarkId)
        setStatus(next)
        if (next.status !== 'running') {
          clearInterval(timer)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error consultando benchmark')
        clearInterval(timer)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [benchmarkId])

  useEffect(() => {
    setTimeoutPreset(nearestTimeoutPreset(timeoutSec))
  }, [timeoutSec])

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])

  const sortedResults = useMemo(
    () => sortRanking(status?.results ?? [], { naLast }),
    [naLast, status?.results],
  )
  const picks = useMemo(() => recommendations(sortedResults), [sortedResults])
  const primaryResult = useMemo(
    () => sortedResults.find((row) => row.resolver === picks.primary),
    [picks.primary, sortedResults],
  )

  const filteredResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return sortedResults.filter((row) => {
      const tags = providerById.get(row.provider_id)?.tags ?? []
      const searchable = `${row.resolver} ${row.provider_name} ${tags.join(' ')}`.toLowerCase()
      const matchesSearch = term.length === 0 || searchable.includes(term)
      const matchesReliable = !onlyReliable || row.stats.timeout_rate <= 0.2
      return matchesSearch && matchesReliable
    })
  }, [onlyReliable, providerById, searchTerm, sortedResults])

  const isRunning = status?.status === 'running'
  const progressPct = status?.progress.total
    ? Math.round((status.progress.current / status.progress.total) * 100)
    : 0
  const activeLanguage = useMemo(
    () => languageOptions.find((option) => option.value === language) ?? languageOptions[0],
    [language],
  )

  useEffect(() => {
    if (!localeMenuOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (localeMenuRef.current && !localeMenuRef.current.contains(event.target as Node)) {
        setLocaleMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setLocaleMenuOpen(false)
      localeTriggerRef.current?.focus()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [localeMenuOpen])

  async function handleStart() {
    setError(null)
    setSelectedResult(null)
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
      setBenchmarkId(response.benchmark_id)
      const initial = await getBenchmark(response.benchmark_id)
      setStatus(initial)
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

  const hasResults = status?.status === 'done'
  const recommendationAvailable = Boolean(picks.primary)
  const reliabilityPct = primaryResult ? Math.max(0, (1 - primaryResult.stats.timeout_rate) * 100) : null

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="hero">
          <h1>{t('app.title')}</h1>
          <p>{t('app.subtitle')}</p>
        </div>

        <div className="header-actions">
          <button
            className="btn-ghost icon-btn theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={nextThemeLabel}
            title={nextThemeLabel}
          >
            <span className="theme-icon" aria-hidden="true">
              {theme === 'dark' ? '☀' : '☾'}
            </span>
          </button>
          <div className="locale-menu" ref={localeMenuRef}>
            <button
              ref={localeTriggerRef}
              className="select-inline locale-trigger"
              type="button"
              aria-label={t('header.language')}
              aria-haspopup="menu"
              aria-expanded={localeMenuOpen}
              onClick={() => setLocaleMenuOpen((prev) => !prev)}
            >
              <span className="locale-current" aria-hidden="true">
                {activeLanguage.flag} {activeLanguage.code}
              </span>
              <span className="select-caret" aria-hidden="true">
                ▾
              </span>
            </button>

            {localeMenuOpen ? (
              <div className="locale-dropdown" role="menu" aria-label={t('header.language')}>
                {languageOptions.map((option) => {
                  const selected = option.value === language
                  return (
                    <button
                      key={option.value}
                      className={`locale-item${selected ? ' is-active' : ''}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        setLanguage(option.value)
                        setLocaleMenuOpen(false)
                        localeTriggerRef.current?.focus()
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
        onStart={() => {
          void handleStart()
        }}
      />

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

      {status && (
        <section className={`card compact status-${status.status}`}>
          <h3>{t('status.title')}</h3>
          <p>
            {t('status.label')}: <strong>{status.status}</strong> | {t('status.engine')}:{' '}
            <strong>{status.engine ?? t('status.pending')}</strong>
          </p>
          {status.status === 'running' && <p>{t('status.runningHint')}</p>}
          {status.status === 'error' && (
            <p>
              {t('status.errorHint', { error: status.error ?? t('status.pending') })}
            </p>
          )}
          <div className="progress-wrap">
            <div className="progress-bar" style={{ width: `${progressPct}%` }} />
          </div>
          <p>
            {t('status.progress', { current: status.progress.current, total: status.progress.total, pct: progressPct })}
          </p>
          <p>{t('status.currentResolver', { resolver: status.progress.current_resolver ?? t('summary.na') })}</p>
        </section>
      )}

      {hasResults && sortedResults.length > 0 && (
        <>
          <section className="card compact next-actions">
            <h3>{t('nextActions.title')}</h3>
            <div className="actions-row">
              <button className="btn-primary" onClick={applyRecommendation} disabled={!recommendationAvailable}>
                {t('nextActions.applyRecommendation')}
              </button>
              <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json`}>
                {t('nextActions.downloadSummary')}
              </a>
              <button className="btn-ghost" onClick={() => primaryResult && handleSelectResult(primaryResult)} disabled={!primaryResult}>
                {t('nextActions.viewDetail')}
              </button>
            </div>
          </section>

          <section className="card compact">
            <h3>{t('recommendation.title')}</h3>
            <p>{t('recommendation.primary', { resolver: picks.primary ?? t('summary.na') })}</p>
            <p>{t('recommendation.secondary', { resolver: picks.secondary ?? t('summary.na') })}</p>
            <p>{t('recommendation.copy')}</p>
          </section>

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
              <article className="metric-card" title="Confiabilidad = 1 - timeout_rate">
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
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={naLast}
                  disabled={isRunning}
                  onChange={(e) => setNaLast(e.target.checked)}
                />
                {t('filters.naLast')}
              </label>
            </div>
          </section>

          <ResultsTable
            results={filteredResults}
            primary={picks.primary}
            secondary={picks.secondary}
            emptyMessage={t('filters.empty')}
            onSelect={handleSelectResult}
          />

          <ChartsPanel results={filteredResults} />

          <section className="card compact">
            <h3>{t('exports.title')}</h3>
            <div className="actions-row">
              <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.csv`}>
                {t('exports.csv')}
              </a>
              <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json`}>
                {t('exports.jsonSummary')}
              </a>
              <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json?include_samples=1`}>
                {t('exports.jsonSamples')}
              </a>
            </div>
          </section>
        </>
      )}

      {hasResults && sortedResults.length === 0 && (
        <section className="card compact">
          <h3>{t('noRanking.title')}</h3>
          <p>{t('noRanking.text')}</p>
        </section>
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
