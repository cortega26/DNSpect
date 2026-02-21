import type { BenchmarkMode, Provider } from '@/lib/types'
import { resolverGroup } from '@/lib/utils'

interface ResolverOption {
  ip: string
  providerId: string
  providerName: string
  group: string
}

interface Props {
  providers: Provider[]
  selected: Set<string>
  mode: BenchmarkMode
  runs: number
  timeoutSec: number
  systemResolvers: string[]
  isRunning: boolean
  onToggleResolver: (ip: string) => void
  onModeChange: (mode: BenchmarkMode) => void
  onRunsChange: (value: number) => void
  onTimeoutChange: (value: number) => void
  onStart: () => void
}

const MODE_LABEL: Record<BenchmarkMode, string> = {
  quick: 'Rápida',
  standard: 'Estándar',
  exhaustive: 'Exhaustiva',
}

export function DashboardControls(props: Props) {
  const providerIndex = new Map(props.providers.map((p) => [p.id, p]))
  const resolverMap = new Map<string, ResolverOption>()

  props.providers.forEach((provider) => {
    provider.dns.forEach((ip) => {
      resolverMap.set(ip, {
        ip,
        providerId: provider.id,
        providerName: provider.name,
        group: resolverGroup(provider),
      })
    })
  })

  props.systemResolvers.forEach((ip) => {
    if (!resolverMap.has(ip)) {
      resolverMap.set(ip, {
        ip,
        providerId: 'isp-detectado',
        providerName: 'ISP (Detectado)',
        group: 'ISP detectados',
      })
    }
  })

  const grouped = Array.from(resolverMap.values()).reduce<Record<string, ResolverOption[]>>((acc, item) => {
    acc[item.group] ??= []
    acc[item.group].push(item)
    return acc
  }, {})

  const groupOrder = ['Global', 'Privacidad', 'LATAM/Chile', 'ISP detectados']

  return (
    <section className="card">
      <div className="card-header">
        <h2>Dashboard</h2>
        <p>Selecciona resolvers y parámetros antes de iniciar la prueba.</p>
      </div>

      <div className="mode-grid">
        {(['quick', 'standard', 'exhaustive'] as BenchmarkMode[]).map((mode) => (
          <button
            key={mode}
            className={`chip ${props.mode === mode ? 'chip-active' : ''}`}
            onClick={() => props.onModeChange(mode)}
            disabled={props.isRunning}
          >
            {MODE_LABEL[mode]}
          </button>
        ))}
      </div>

      <details className="advanced">
        <summary>Opciones avanzadas</summary>
        <div className="advanced-grid">
          <label>
            Runs
            <input
              type="number"
              min={1}
              max={300}
              value={props.runs}
              disabled={props.isRunning}
              onChange={(e) => props.onRunsChange(Number(e.target.value))}
            />
          </label>
          <label>
            Timeout (s)
            <input
              type="number"
              min={0.2}
              max={10}
              step={0.1}
              value={props.timeoutSec}
              disabled={props.isRunning}
              onChange={(e) => props.onTimeoutChange(Number(e.target.value))}
            />
          </label>
        </div>
      </details>

      <div className="resolver-groups">
        {groupOrder
          .filter((group) => grouped[group]?.length)
          .map((group) => (
            <div key={group} className="resolver-group">
              <h3>{group}</h3>
              <div className="resolver-list">
                {grouped[group]
                  .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.ip.localeCompare(b.ip))
                  .map((item) => (
                    <label key={item.ip} className="resolver-item">
                      <input
                        type="checkbox"
                        checked={props.selected.has(item.ip)}
                        disabled={props.isRunning}
                        onChange={() => props.onToggleResolver(item.ip)}
                      />
                      <span className="resolver-label">{item.ip}</span>
                      <span className="resolver-provider">
                        {providerIndex.get(item.providerId)?.name ?? item.providerName}
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          ))}
      </div>

      <button className="start-btn" onClick={props.onStart} disabled={props.isRunning || props.selected.size === 0}>
        Iniciar prueba
      </button>
    </section>
  )
}
