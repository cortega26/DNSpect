import { useMemo, useState } from 'react'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { ResolverResult } from '@/lib/types'

interface Props {
  results: ResolverResult[]
  variant?: 'minimal' | 'full'
}

export function ChartsPanel({ results, variant = 'full' }: Props) {
  const [topN, setTopN] = useState<number>(10)

  const limitedResults = useMemo(() => {
    if (topN <= 0) return results
    return results.slice(0, topN)
  }, [results, topN])

  const bars = limitedResults.map((r) => ({
    dns: r.resolver,
    mediana: r.stats.median_ms ?? null,
  }))

  return (
    <section className="card">
      <div className="card-header">
        <h2>Gráficos</h2>
        <p>{variant === 'minimal' ? 'Vista rápida del Top-N por mediana.' : 'Comparativa Top-N por mediana.'}</p>
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

      {limitedResults.length === 0 ? (
        <div className="empty-state">No hay datos para graficar con los filtros actuales.</div>
      ) : (
        <div className={variant === 'minimal' ? 'chart-single' : 'chart-grid'}>
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
        </div>
      )}
    </section>
  )
}
