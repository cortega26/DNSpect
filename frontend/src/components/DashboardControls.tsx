import type { BenchmarkMode, BenchmarkProtocol, Goal, Provider } from '@/lib/types'
import { GOALS, PROTOCOLS } from '@/lib/types'
import { useI18n } from '@/lib/useI18n'
import { resolverGroup } from '@/lib/utils'

interface ResolverOption {
  ip: string
  providerId: string
  providerName: string
  group: string
}

export type TimeoutPreset = 'low' | 'medium' | 'high'

const GOAL_LABEL_KEY: Record<Goal, 'goal.speed' | 'goal.security' | 'goal.privacy' | 'goal.adBlocking' | 'goal.family'> = {
  speed: 'goal.speed',
  security: 'goal.security',
  privacy: 'goal.privacy',
  'ad-blocking': 'goal.adBlocking',
  family: 'goal.family',
}

const GOAL_HELP_KEY: Record<Goal, 'goal.speedHelp' | 'goal.securityHelp' | 'goal.privacyHelp' | 'goal.adBlockingHelp' | 'goal.familyHelp'> = {
  speed: 'goal.speedHelp',
  security: 'goal.securityHelp',
  privacy: 'goal.privacyHelp',
  'ad-blocking': 'goal.adBlockingHelp',
  family: 'goal.familyHelp',
}

interface Props {
  providers: Provider[]
  selected: Set<string>
  mode: BenchmarkMode
  protocol: BenchmarkProtocol
  goal: Goal
  detectedRegion: string | null
  effectiveRegion: string | null
  regionLabel: (r: string | null) => string
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
  onProtocolChange: (protocol: BenchmarkProtocol) => void
  onGoalChange: (goal: Goal) => void
  onRegionChange: (region: string | null) => void
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

  const groupKeys = Array.from(new Set(Object.keys(grouped)))
  const groupPriority: Record<string, number> = {
    Global: 0,
    Privacidad: 1,
    'ISP detectados': 99,
  }
  const sortedGroups = groupKeys.sort((a, b) => {
    const pa = groupPriority[a] ?? 50
    const pb = groupPriority[b] ?? 50
    return pa - pb || a.localeCompare(b)
  })

  function groupLabel(group: string): string {
    if (group === 'Global') return t('group.global')
    if (group === 'Privacidad') return t('group.privacy')
    if (group === 'ISP detectados') return t('group.isp')
    return group
  }

  return (
    <section className="card card-compact-controls">
      <div className="card-header">
        <h2>{t('controls.title')}</h2>
        <p>{t('controls.subtitle')}</p>
      </div>

      <div className="controls-grid">
        <div className="controls-mode-col">
          <p className="label-caption">{t('controls.mode')}</p>
          <div className="segmented-control" role="radiogroup" aria-label={t('controls.mode')}>
            {(['quick', 'standard', 'exhaustive'] as BenchmarkMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={props.mode === mode}
                className={`segmented-option ${props.mode === mode ? 'is-active' : ''}`}
                onClick={() => props.onModeChange(mode)}
                disabled={props.isRunning}
              >
                {t(MODE_LABEL_KEY[mode])}
              </button>
            ))}
          </div>
          <p className="helper-text">{t('controls.modeHelp')}</p>
        </div>

        <div className="controls-protocol-col">
          <p className="label-caption">{t('controls.protocol')}</p>
          <div className="segmented-control" role="radiogroup" aria-label={t('controls.protocol')}>
            {PROTOCOLS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={props.protocol === p}
                className={`segmented-option ${props.protocol === p ? 'is-active' : ''}`}
                onClick={() => props.onProtocolChange(p)}
                disabled={props.isRunning}
              >
                {p === 'udp' ? t('protocol.udp') : p === 'dot' ? t('protocol.dot') : t('protocol.doh')}
              </button>
            ))}
          </div>
          <p className="helper-text">{t('protocol.help')}</p>
        </div>
      </div>

      <div className="goal-selector">
        <p className="label-caption">{t('goal.title')}</p>
        <div className="mode-grid">
          {GOALS.map((g) => (
            <button
              key={g}
              type="button"
              className={`chip-compact ${props.goal === g ? 'chip-active' : ''}`}
              onClick={() => props.onGoalChange(g)}
              disabled={props.isRunning}
            >
              {t(GOAL_LABEL_KEY[g])}
            </button>
          ))}
        </div>
        <p className="helper-text">{t(GOAL_HELP_KEY[props.goal])}</p>
      </div>

      <div className="region-selector">
        <p className="label-caption">{t('region.title')}</p>
        <div className="mode-grid region-chips">
          <button
            type="button"
            className={`chip-compact${props.effectiveRegion === props.detectedRegion && props.effectiveRegion !== 'all' && props.effectiveRegion !== 'global' ? ' chip-active' : ''}`}
            onClick={() => props.onRegionChange(null)}
            disabled={props.isRunning}
          >
            Auto{props.detectedRegion ? ` (${props.detectedRegion})` : ''}
          </button>
          {['global', 'europe', 'south-america', 'north-america', 'asia'].map((r) => (
            <button
              key={r}
              type="button"
              className={`chip-compact${props.effectiveRegion === r ? ' chip-active' : ''}`}
              onClick={() => props.onRegionChange(r)}
              disabled={props.isRunning}
            >
              {props.regionLabel(r)}
            </button>
          ))}
          <button
            type="button"
            className={`chip-compact${props.effectiveRegion === 'all' ? ' chip-active' : ''}`}
            onClick={() => props.onRegionChange('all')}
            disabled={props.isRunning}
          >
            {t('region.all')}
          </button>
        </div>
        <p className="helper-text">
          {props.effectiveRegion && props.effectiveRegion !== 'all'
            ? t('region.help', { region: props.regionLabel(props.effectiveRegion) })
            : t('region.helpAll')}
        </p>
      </div>

      <div className="actions-row controls-actions">
        <div className="start-cta">
          <button className="btn-start" onClick={props.onStart} disabled={props.isRunning || props.selected.size === 0}>
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
              <span className="advanced-timeout-chips">
                {(['low', 'medium', 'high'] as TimeoutPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`chip-compact${props.timeoutPreset === preset ? ' chip-active' : ''}`}
                    onClick={() => props.onTimeoutPresetChange(preset)}
                    disabled={props.isRunning}
                  >
                    {t(PRESET_LABEL_KEY[preset])}
                  </button>
                ))}
              </span>
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
            {sortedGroups
              .filter((group) => grouped[group]?.length)
              .map((group) => (
                <div key={group} className="resolver-group">
                  <h3>{groupLabel(group)}</h3>
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
