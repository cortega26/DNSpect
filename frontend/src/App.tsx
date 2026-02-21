import { useEffect, useMemo, useState } from 'react'

import { ChartsPanel } from '@/components/ChartsPanel'
import { DashboardControls } from '@/components/DashboardControls'
import { ResolverDetailModal } from '@/components/ResolverDetailModal'
import { ResultsTable } from '@/components/ResultsTable'
import { getBenchmark, getProviders, getSystemDns, startBenchmark } from '@/lib/api'
import type { BenchmarkMode, BenchmarkStatus, Provider, ResolverResult, SystemDnsPayload } from '@/lib/types'
import { API_BASE, fmtMs, recommendations, sortRanking } from '@/lib/utils'

const MODE_RUNS: Record<BenchmarkMode, number> = {
  quick: 12,
  standard: 30,
  exhaustive: 80,
}

type TabId = 'basic' | 'advanced'
type TimeoutPreset = 'low' | 'medium' | 'high'

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

function App() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [systemDns, setSystemDns] = useState<SystemDnsPayload | null>(null)
  const [selectedResolvers, setSelectedResolvers] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<TabId>('basic')
  const [mode, setMode] = useState<BenchmarkMode>('standard')
  const [runs, setRuns] = useState<number>(MODE_RUNS.standard)
  const [timeoutSec, setTimeoutSec] = useState<number>(2)
  const [timeoutPreset, setTimeoutPreset] = useState<TimeoutPreset>('medium')
  const [queriesText, setQueriesText] = useState<string>('')
  const [benchmarkId, setBenchmarkId] = useState<string | null>(null)
  const [status, setStatus] = useState<BenchmarkStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedResult, setSelectedResult] = useState<ResolverResult | null>(null)
  const [loadingSamples, setLoadingSamples] = useState<boolean>(false)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [onlyReliable, setOnlyReliable] = useState<boolean>(false)
  const [naLast, setNaLast] = useState<boolean>(true)

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

  async function handleStart() {
    setError(null)
    setSelectedResult(null)
    try {
      const customQueries = activeTab === 'advanced' ? parseQueries(queriesText) : []
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
      setError(e instanceof Error ? e.message : 'No se pudo iniciar benchmark')
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

  function onBasicModeChange(nextMode: BenchmarkMode) {
    if (nextMode === 'exhaustive') return
    onModeChange(nextMode)
  }

  function switchTab(nextTab: TabId) {
    if (nextTab === 'basic' && mode === 'exhaustive') {
      onModeChange('standard')
    }
    setActiveTab(nextTab)
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
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las muestras')
    } finally {
      setLoadingSamples(false)
    }
  }

  const hasResults = status?.status === 'done'
  const recommendationAvailable = Boolean(picks.primary)
  const reliabilityPct = primaryResult ? Math.max(0, (1 - primaryResult.stats.timeout_rate) * 100) : null

  return (
    <div className="app-shell">
      <header className="hero">
        <h1>DNS Speed Lab</h1>
        <p>
          Benchmark local de resolución DNS real (sin ping). Compara latencia, consistencia y timeouts con una vista clara
          en español.
        </p>
      </header>

      <section className="tab-shell">
        <div className="tab-list" role="tablist" aria-label="Vistas de uso">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'basic'}
            className={`tab-btn ${activeTab === 'basic' ? 'tab-btn-active' : ''}`}
            onClick={() => switchTab('basic')}
          >
            Básico
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'advanced'}
            className={`tab-btn ${activeTab === 'advanced' ? 'tab-btn-active' : ''}`}
            onClick={() => switchTab('advanced')}
          >
            Avanzado
          </button>
        </div>

        {activeTab === 'basic' ? (
          <section className="card">
            <div className="card-header">
              <h2>Flujo guiado</h2>
              <p>Elige modo y tolerancia, luego inicia. La selección de resolvers queda gestionada automáticamente.</p>
            </div>
            <div className="basic-grid">
              <div>
                <p className="label-caption">Modo</p>
                <div className="mode-grid">
                  {(['quick', 'standard'] as BenchmarkMode[]).map((basicMode) => (
                    <button
                      key={basicMode}
                      type="button"
                      className={`chip ${mode === basicMode ? 'chip-active' : ''}`}
                      onClick={() => onBasicModeChange(basicMode)}
                      disabled={isRunning}
                    >
                      {basicMode === 'quick' ? 'Quick' : 'Standard'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="label-caption">Timeout</p>
                <div className="mode-grid">
                  {(['low', 'medium', 'high'] as TimeoutPreset[]).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`chip ${timeoutPreset === preset ? 'chip-active' : ''}`}
                      onClick={() => {
                        setTimeoutPreset(preset)
                        setTimeoutSec(BASIC_TIMEOUT_PRESET[preset])
                      }}
                      disabled={isRunning}
                    >
                      {preset === 'low' ? 'Bajo' : preset === 'medium' ? 'Medio' : 'Alto'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="actions-row">
              <button
                className="btn-primary"
                onClick={() => {
                  void handleStart()
                }}
                disabled={isRunning || selectedResolvers.size === 0}
              >
                Iniciar benchmark
              </button>
              <p className="muted">Resolvers incluidos: {selectedResolvers.size}</p>
            </div>
          </section>
        ) : (
          <>
            <DashboardControls
              providers={providers}
              selected={selectedResolvers}
              mode={mode}
              runs={runs}
              timeoutSec={timeoutSec}
              queriesText={queriesText}
              systemResolvers={systemDns?.resolvers ?? []}
              isRunning={isRunning}
              onToggleResolver={toggleResolver}
              onModeChange={onModeChange}
              onRunsChange={(v) => setRuns(Math.max(1, Math.min(300, Number.isFinite(v) ? v : runs)))}
              onTimeoutChange={(v) => setTimeoutSec(Math.max(0.2, Math.min(10, Number.isFinite(v) ? v : timeoutSec)))}
              onQueriesTextChange={setQueriesText}
              onStart={() => {
                void handleStart()
              }}
            />

            {systemDns && (
              <section className="card compact">
                <h3>DNS detectados del sistema</h3>
                <p>
                  Método: <strong>{systemDns.method}</strong> | Plataforma: <strong>{systemDns.platform}</strong>
                </p>
                <p>{systemDns.resolvers.length ? systemDns.resolvers.join(', ') : 'No se detectaron resolvers locales.'}</p>
              </section>
            )}
          </>
        )}
      </section>

      {error && (
        <section className="error-box" role="alert">
          <p>
            <strong>No se pudo completar la acción:</strong> {error}
          </p>
          <ul className="hint-list">
            <li>Verifica que el backend esté activo y sin bloqueo de red.</li>
            <li>Reduce timeout o cantidad de resolvers si el equipo está saturado.</li>
            <li>Reintenta la prueba en unos segundos.</li>
          </ul>
        </section>
      )}

      {status && (
        <section className={`card compact status-${status.status}`}>
          <h3>Estado del benchmark</h3>
          <p>
            Estado: <strong>{status.status}</strong> | Motor: <strong>{status.engine ?? 'pendiente'}</strong>
          </p>
          {status.status === 'running' && <p>Ejecutando consultas. Mantén esta ventana abierta hasta completar el 100%.</p>}
          {status.status === 'error' && (
            <p>
              El benchmark reportó error: <strong>{status.error ?? 'sin detalle adicional'}</strong>
            </p>
          )}
          <div className="progress-wrap">
            <div className="progress-bar" style={{ width: `${progressPct}%` }} />
          </div>
          <p>
            Progreso: {status.progress.current}/{status.progress.total} ({progressPct}%)
          </p>
          <p>Resolver actual: {status.progress.current_resolver ?? 'N/A'}</p>
        </section>
      )}

      {hasResults && sortedResults.length > 0 && (
        <>
          <section className="card compact next-actions">
            <h3>Siguientes acciones</h3>
            <div className="actions-row">
              <button className="btn-primary" onClick={applyRecommendation} disabled={!recommendationAvailable}>
                Aplicar recomendación
              </button>
              <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json`}>
                Descargar resumen
              </a>
              <button className="btn-ghost" onClick={() => primaryResult && handleSelectResult(primaryResult)} disabled={!primaryResult}>
                Ver detalle
              </button>
            </div>
          </section>

          {activeTab === 'basic' && (
            <>
              <section className="card compact">
                <h3>Recomendación</h3>
                <p>
                  Primario sugerido: <strong>{picks.primary ?? 'N/A'}</strong> | Secundario sugerido:{' '}
                  <strong>{picks.secondary ?? 'N/A'}</strong>
                </p>
                <p>Recomendado para un equilibrio entre velocidad, estabilidad y fallos mínimos.</p>
              </section>

              <section className="card compact">
                <h3>Resumen rápido</h3>
                <div className="summary-grid">
                  <article className="metric-card" title="Rápido = mediana (ms)">
                    <h4>Rápido</h4>
                    <p>{fmtMs(primaryResult?.stats.median_ms ?? null)}</p>
                  </article>
                  <article className="metric-card" title="Estable = p95 (ms)">
                    <h4>Estable</h4>
                    <p>{fmtMs(primaryResult?.stats.p95_ms ?? null)}</p>
                  </article>
                  <article className="metric-card" title="Confiable = 1 - timeout_rate">
                    <h4>Confiable</h4>
                    <p>{reliabilityPct === null ? 'NA' : `${reliabilityPct.toFixed(0)}%`}</p>
                  </article>
                </div>
              </section>

              <ChartsPanel results={filteredResults} variant="minimal" />
            </>
          )}

          {activeTab === 'advanced' && (
            <>
              <section className="card compact">
                <h3>Cómo leer los resultados</h3>
                <p>
                  <strong>Mediana:</strong> latencia típica. <strong>p95:</strong> estabilidad en escenarios malos.{' '}
                  <strong>Timeouts:</strong> fallos por demora.
                </p>
                <p>
                  Nota: <strong>hacer ping al DNS no mide resolución DNS</strong>; esta app sí mide el tiempo real de consulta.
                </p>
              </section>

              <section className="card compact">
                <h3>Filtros de ranking</h3>
                <div className="filters-grid">
                  <label>
                    Buscar (IP, proveedor, tags)
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="ej: cloudflare, 1.1.1.1, privacidad"
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
                    Solo confiables (timeout_rate ≤ 0.20)
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={naLast}
                      disabled={isRunning}
                      onChange={(e) => setNaLast(e.target.checked)}
                    />
                    Mostrar NA al final
                  </label>
                </div>
              </section>

              <ResultsTable
                results={filteredResults}
                primary={picks.primary}
                secondary={picks.secondary}
                emptyMessage="No hay resultados para los filtros aplicados. Ajusta búsqueda o desactiva filtros."
                onSelect={handleSelectResult}
              />

              <ChartsPanel results={filteredResults} variant="full" />

              <section className="card compact">
                <h3>Exportar</h3>
                <div className="actions-row">
                  <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.csv`}>
                    Descargar CSV
                  </a>
                  <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json`}>
                    Descargar JSON (resumen)
                  </a>
                  <a className="btn-secondary" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json?include_samples=1`}>
                    Descargar JSON (con muestras)
                  </a>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {hasResults && sortedResults.length === 0 && (
        <section className="card compact">
          <h3>Sin datos de ranking</h3>
          <p>La prueba terminó sin resultados utilizables. Reintenta con más timeout o menos resolvers.</p>
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
