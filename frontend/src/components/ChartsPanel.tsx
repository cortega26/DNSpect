import { useMemo, useState } from 'react'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { ResolverResult } from '@/lib/types'

interface Props {
  results: ResolverResult[]
}

export function ChartsPanel({ results }: Props) {
  const [topN, setTopN] = useState<number>(10)

  const limitedResults = useMemo(() => {
    if (topN <= 0) return results
    return results.slice(0, topN)
  }, [results, topN])

  const bars = limitedResults.map((r) => ({
    dns: r.resolver,
    mediana: r.stats.median_ms ?? null,
  }))

  const scatter = limitedResults
    .filter((r) => r.stats.median_ms !== null && r.stats.p95_ms !== null)
    .map((r) => ({
      dns: r.resolver,
      mediana: r.stats.median_ms,
      p95: r.stats.p95_ms,
    }))

  return (
    <section className="card">
      <div className="card-header">
        <h2>Gráficos</h2>
        <p>Mediana por resolver y relación mediana vs p95 para consistencia.</p>
        <div className="chart-controls">
          <label>
            Mostrar
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
              <option value={10}>Top 10</option>
              <option value={15}>Top 15</option>
              <option value={0}>Todos</option>
            </select>
            resolvers por mediana
          </label>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Mediana por resolver</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={bars} margin={{ top: 8, right: 16, left: 8, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dns" angle={-35} textAnchor="end" height={70} interval={0} />
              <YAxis unit=" ms" />
              <Tooltip />
              <Bar dataKey="mediana" fill="#0f766e" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Consistencia (Mediana vs p95)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
              <CartesianGrid />
              <XAxis type="number" dataKey="mediana" name="Mediana" unit=" ms" />
              <YAxis type="number" dataKey="p95" name="p95" unit=" ms" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Legend />
              <Scatter data={scatter} name="Resolvers" fill="#0ea5e9" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
