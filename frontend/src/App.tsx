import { useEffect, useMemo, useState } from 'react'

import { ChartsPanel } from '@/components/ChartsPanel'
import { DashboardControls } from '@/components/DashboardControls'
import { ResolverDetailModal } from '@/components/ResolverDetailModal'
import { ResultsTable } from '@/components/ResultsTable'
import { getBenchmark, getProviders, getSystemDns, startBenchmark } from '@/lib/api'
import type { BenchmarkMode, BenchmarkStatus, Provider, ResolverResult, SystemDnsPayload } from '@/lib/types'
import { API_BASE, recommendations, sortRanking } from '@/lib/utils'

const MODE_RUNS: Record<BenchmarkMode, number> = {
  quick: 12,
  standard: 30,
  exhaustive: 80,
}

function App() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [systemDns, setSystemDns] = useState<SystemDnsPayload | null>(null)
  const [selectedResolvers, setSelectedResolvers] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<BenchmarkMode>('standard')
  const [runs, setRuns] = useState<number>(MODE_RUNS.standard)
  const [timeoutSec, setTimeoutSec] = useState<number>(2)
  const [benchmarkId, setBenchmarkId] = useState<string | null>(null)
  const [status, setStatus] = useState<BenchmarkStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedResult, setSelectedResult] = useState<ResolverResult | null>(null)
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

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])

  const sortedResults = useMemo(
    () => sortRanking(status?.results ?? [], { naLast }),
    [naLast, status?.results],
  )
  const picks = useMemo(() => recommendations(sortedResults), [sortedResults])

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
      const response = await startBenchmark({
        mode,
        runs,
        timeout_sec: timeoutSec,
        resolvers: Array.from(selectedResolvers),
      })
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

  function applyRecommendation() {
    const toApply = [picks.primary, picks.secondary].filter(Boolean) as string[]
    if (toApply.length === 0) return
    setSelectedResolvers(new Set(toApply))
  }

  async function handleSelectResult(result: ResolverResult) {
    if (result.samples.length > 0 || !benchmarkId) {
      setSelectedResult(result)
      return
    }
    try {
      const full = await getBenchmark(benchmarkId, true)
      const resolved = full.results?.find((r) => r.resolver === result.resolver)
      setSelectedResult(resolved ?? result)
    } catch {
      setSelectedResult(result)
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <h1>DNS Speed Lab</h1>
        <p>
          Benchmark local de resolución DNS real (sin ping). Compara latencia, consistencia y timeouts con una vista clara
          en español.
        </p>
      </header>

      {error && <div className="error-box">{error}</div>}

      <DashboardControls
        providers={providers}
        selected={selectedResolvers}
        mode={mode}
        runs={runs}
        timeoutSec={timeoutSec}
        systemResolvers={systemDns?.resolvers ?? []}
        isRunning={isRunning}
        onToggleResolver={toggleResolver}
        onModeChange={onModeChange}
        onRunsChange={(v) => setRuns(Math.max(1, Math.min(300, Number.isFinite(v) ? v : runs)))}
        onTimeoutChange={(v) => setTimeoutSec(Math.max(0.2, Math.min(10, Number.isFinite(v) ? v : timeoutSec)))}
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

      {status && (
        <section className="card compact">
          <h3>Estado del benchmark</h3>
          <p>
            Estado: <strong>{status.status}</strong> | Motor: <strong>{status.engine ?? 'pendiente'}</strong>
          </p>
          <div className="progress-wrap">
            <div className="progress-bar" style={{ width: `${progressPct}%` }} />
          </div>
          <p>
            Progreso: {status.progress.current}/{status.progress.total} ({progressPct}%)
          </p>
          <p>Resolver actual: {status.progress.current_resolver ?? 'N/A'}</p>
        </section>
      )}

      {status?.status === 'done' && sortedResults.length > 0 && (
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
            <h3>Recomendación</h3>
            <p>
              Primario sugerido: <strong>{picks.primary ?? 'N/A'}</strong> | Secundario sugerido:{' '}
              <strong>{picks.secondary ?? 'N/A'}</strong>
            </p>
            <p>Heurística: menor mediana + menor timeout_rate, con desempate por p95.</p>
            <div className="actions-row">
              <button className="start-btn" onClick={applyRecommendation} disabled={!picks.primary}>
                Aplicar recomendación
              </button>
            </div>
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
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={onlyReliable}
                  onChange={(e) => setOnlyReliable(e.target.checked)}
                />
                Solo confiables (timeout_rate ≤ 0.20)
              </label>
              <label className="toggle">
                <input type="checkbox" checked={naLast} onChange={(e) => setNaLast(e.target.checked)} />
                Mostrar NA al final
              </label>
            </div>
          </section>

          <ResultsTable
            results={filteredResults}
            primary={picks.primary}
            secondary={picks.secondary}
            onSelect={(result) => {
              void handleSelectResult(result)
            }}
          />

          <ChartsPanel results={filteredResults} />

          <section className="card compact">
            <h3>Exportar</h3>
            <div className="actions-row">
              <a className="export-btn" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.csv`}>
                Descargar CSV
              </a>
              <a className="export-btn" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json`}>
                Descargar JSON (resumen)
              </a>
              <a className="export-btn" href={`${API_BASE}/api/benchmarks/${benchmarkId}/export.json?include_samples=1`}>
                Descargar JSON (con muestras)
              </a>
            </div>
          </section>
        </>
      )}

      {selectedResult && (
        <ResolverDetailModal
          result={selectedResult}
          provider={providers.find((p) => p.id === selectedResult.provider_id)}
          onClose={() => setSelectedResult(null)}
        />
      )}
    </div>
  )
}

export default App
