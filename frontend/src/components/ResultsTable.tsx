import type { ResolverResult } from '@/lib/types'
import { fmtMs } from '@/lib/utils'

interface Props {
  results: ResolverResult[]
  primary?: string
  secondary?: string
  onSelect: (result: ResolverResult) => void
}

export function ResultsTable({ results, primary, secondary, onSelect }: Props) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>Ranking</h2>
        <p>Ordenado por mediana, luego p95 y cantidad de timeouts.</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DNS</th>
              <th>Proveedor</th>
              <th>Mediana</th>
              <th>p95</th>
              <th>Promedio</th>
              <th>Timeouts</th>
              <th>OK</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => {
              const badge = row.resolver === primary ? 'Primario recomendado' : row.resolver === secondary ? 'Secundario recomendado' : ''
              return (
                <tr key={row.resolver} onClick={() => onSelect(row)}>
                  <td>
                    <div className="dns-cell">
                      <span>{row.resolver}</span>
                      {badge && <small className="badge">{badge}</small>}
                    </div>
                  </td>
                  <td>{row.provider_name}</td>
                  <td>{fmtMs(row.stats.median_ms)}</td>
                  <td>{fmtMs(row.stats.p95_ms)}</td>
                  <td>{fmtMs(row.stats.avg_ms)}</td>
                  <td>{row.stats.timeout_count}</td>
                  <td>{row.stats.ok_count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
