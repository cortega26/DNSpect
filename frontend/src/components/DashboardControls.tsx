import type { BenchmarkMode, Provider } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'
import { resolverGroup } from '@/lib/utils'

interface ResolverOption {
  ip: string
  providerId: string
  providerName: string
  group: string
}

export type TimeoutPreset = 'low' | 'medium' | 'high'

interface Props {
  providers: Provider[]
  selected: Set<string>
  mode: BenchmarkMode
  runs: number
  timeoutSec: number
  timeoutPreset: TimeoutPreset
  queriesText: string
  systemResolvers: string[]
  isRunning: boolean
  advancedOpen: boolean
  workloadSummary: string
  startHelperText: string
  onToggleResolver: (ip: string) => void
  onModeChange: (mode: BenchmarkMode) => void
  onRunsChange: (value: number) => void
  onTimeoutChange: (value: number) => void
  onTimeoutPresetChange: (value: TimeoutPreset) => void
  onQueriesTextChange: (value: string) => void
  onToggleAdvanced: () => void
  onShowResolverList: () => void
  onStart: () => void
}

const MODE_LABEL_KEY: Record<BenchmarkMode, 'controls.modeQuick' | 'controls.modeStandard' | 'controls.modeExhaustive'> = {
  quick: 'controls.modeQuick',
  standard: 'controls.modeStandard',
  exhaustive: 'controls.modeExhaustive',
}

const PRESET_LABEL_KEY: Record<TimeoutPreset, 'controls.timeoutLow' | 'controls.timeoutMedium' | 'controls.timeoutHigh'> = {
  low: 'controls.timeoutLow',
  medium: 'controls.timeoutMedium',
  high: 'controls.timeoutHigh',
}

export function DashboardControls(props: Props) {
  const { t } = useI18n()
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
        providerName: t('group.isp'),
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
  const groupLabels: Record<string, string> = {
    Global: t('group.global'),
    Privacidad: t('group.privacy'),
    'LATAM/Chile': t('group.latam'),
    'ISP detectados': t('group.isp'),
  }

  return (
    <section className="card controls-card">
      <div className="card-header">
        <h2>{t('controls.title')}</h2>
        <p>{t('controls.subtitle')}</p>
      </div>

      <div className="controls-grid">
        <div>
          <p className="label-caption">{t('controls.mode')}</p>
          <div className="mode-grid">
            {(['quick', 'standard', 'exhaustive'] as BenchmarkMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`chip ${props.mode === mode ? 'chip-active' : ''}`}
                onClick={() => props.onModeChange(mode)}
                disabled={props.isRunning}
              >
                {t(MODE_LABEL_KEY[mode])}
              </button>
            ))}
          </div>
          <p className="helper-text">{t('controls.modeHelp')}</p>
        </div>
        <div>
          <p className="label-caption">{t('controls.timeoutPreset')}</p>
          <div className="mode-grid">
            {(['low', 'medium', 'high'] as TimeoutPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                className={`chip ${props.timeoutPreset === preset ? 'chip-active' : ''}`}
                onClick={() => props.onTimeoutPresetChange(preset)}
                disabled={props.isRunning}
              >
                {t(PRESET_LABEL_KEY[preset])}
              </button>
            ))}
          </div>
          <p className="helper-text">{t('controls.timeoutHelp')}</p>
        </div>
      </div>

      <div className="actions-row controls-actions">
        <div className="start-cta">
          <button className="btn-primary" onClick={props.onStart} disabled={props.isRunning || props.selected.size === 0}>
            {t('controls.start')}
          </button>
          <p className="helper-text start-subtext">{props.startHelperText}</p>
        </div>
        <button type="button" className="inline-link resolver-count-link" onClick={props.onShowResolverList}>
          {t('controls.selectedResolvers', { count: props.selected.size })}
        </button>
        <button
          type="button"
          className="text-link advanced-toggle-link"
          onClick={props.onToggleAdvanced}
          aria-expanded={props.advancedOpen}
          aria-controls="advanced-controls"
        >
          {props.advancedOpen ? t('controls.closeAdvanced') : t('controls.openAdvanced')}
        </button>
      </div>
      <p className="helper-text">{props.workloadSummary}</p>

      <div id="advanced-controls" className={`advanced-collapse ${props.advancedOpen ? 'is-open' : ''}`}>
        <div className="advanced-inner">
          <div className="card-header small">
            <h3>{t('controls.advancedTitle')}</h3>
            <p>{t('controls.advancedSubtitle')}</p>
          </div>

          <div className="advanced-grid">
            <label>
              {t('controls.runs')}
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
              {t('controls.timeoutSeconds')}
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
            <label className="queries-field">
              {t('controls.queries')}
              <textarea
                value={props.queriesText}
                disabled={props.isRunning}
                onChange={(e) => props.onQueriesTextChange(e.target.value)}
                placeholder={t('controls.queriesPlaceholder')}
              />
            </label>
          </div>

          <div className="resolver-groups">
            {groupOrder
              .filter((group) => grouped[group]?.length)
              .map((group) => (
                <div key={group} className="resolver-group">
                  <h3>{groupLabels[group] ?? group}</h3>
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
        </div>
      </div>
    </section>
  )
}
