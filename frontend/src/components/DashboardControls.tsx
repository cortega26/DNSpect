import type { BenchmarkMode, BenchmarkProtocol, Goal, Provider, ScoringProfile } from '@/lib/types'
import { COMPARISON_PROTOCOLS, GOALS, PROTOCOLS } from '@/lib/types'
import type { ProtocolComparisonPreflight } from '@/lib/types'
import type { TranslationKey } from '@/lib/i18n-translations'
import { useI18n } from '@/lib/useI18n'
import { regionLabelKey, resolverGroup } from '@/lib/utils'
import { CATALOG_SCOPES, type TargetScope } from '@/lib/targetScope'

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
  scoringProfile: ScoringProfile
  scope: TargetScope
  scopeSource: 'auto' | 'manual'
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
  onScoringProfileChange: (profile: ScoringProfile) => void
  onScopeSelect: (scope: TargetScope) => void
  onScopeReset: () => void
  onRunsChange: (value: number) => void
  onTimeoutChange: (value: number) => void
  onTimeoutPresetChange: (value: TimeoutPreset) => void
  onQueriesTextChange: (value: string) => void
  onToggleAdvanced: () => void
  onShowResolverList: () => void
  onStart: () => void
  comparisonOpen: boolean
  comparisonProtocols: BenchmarkProtocol[]
  comparisonPreflight: ProtocolComparisonPreflight | null
  comparisonPreflightLoading: boolean
  comparisonPreflightError: string | null
  comparisonActive: boolean
  onToggleComparison: () => void
  onToggleComparisonProtocol: (protocol: BenchmarkProtocol) => void
  onStartComparison: () => void
  doqAvailable?: boolean
}

const PROTOCOL_LABEL_KEY: Record<BenchmarkProtocol, 'protocol.udp' | 'protocol.dot' | 'protocol.doh' | 'protocol.doq'> = {
  udp: 'protocol.udp',
  dot: 'protocol.dot',
  doh: 'protocol.doh',
  doq: 'protocol.doq',
}

const EXCLUSION_LABEL_KEY: Record<string, TranslationKey> = {
  dot_hostname_missing: 'comparisonMode.exclusionReason.dot_hostname_missing',
  dot_hostname_invalid: 'comparisonMode.exclusionReason.dot_hostname_invalid',
  doh_url_missing: 'comparisonMode.exclusionReason.doh_url_missing',
  doh_url_invalid: 'comparisonMode.exclusionReason.doh_url_invalid',
}

const ADMISSION_LABEL_KEY: Record<string, TranslationKey> = {
  no_common_targets: 'comparisonMode.reason.no_common_targets',
  attempt_budget_exceeded: 'comparisonMode.reason.attempt_budget_exceeded',
  duration_budget_exceeded: 'comparisonMode.reason.duration_budget_exceeded',
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

export function DashboardControls({ doqAvailable = true, ...props }: Props) {
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
            {PROTOCOLS.filter((p) => p !== 'doq' || doqAvailable).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={props.protocol === p}
                className={`segmented-option ${props.protocol === p ? 'is-active' : ''}`}
                onClick={() => props.onProtocolChange(p)}
                disabled={props.isRunning}
              >
                {t(PROTOCOL_LABEL_KEY[p])}
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
                className={`chip-compact ${props.scoringProfile === g ? 'chip-active' : ''}`}
                onClick={() => props.onScoringProfileChange(g)}
                disabled={props.isRunning}
              >
                {t(GOAL_LABEL_KEY[g])}
              </button>
            ))}
          </div>
          <p className="helper-text">{t(GOAL_HELP_KEY[props.scoringProfile])}</p>
      </div>

      <div className="region-selector">
        <p className="label-caption">{t('region.title')}</p>
        <div className="mode-grid region-chips">
          <button
            type="button"
            className={`chip-compact${props.scopeSource === 'auto' ? ' chip-active' : ''}`}
            onClick={props.onScopeReset}
            disabled={props.isRunning}
          >
            {t(regionLabelKey(null))}
          </button>
          {CATALOG_SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              className={`chip-compact${props.scope === scope && props.scopeSource === 'manual' ? ' chip-active' : ''}`}
              onClick={() => props.onScopeSelect(scope)}
              disabled={props.isRunning}
            >
              {t(regionLabelKey(scope))}
            </button>
          ))}
          <button
            type="button"
            className={`chip-compact${props.scope === 'all' && props.scopeSource === 'manual' ? ' chip-active' : ''}`}
            onClick={() => props.onScopeSelect('all')}
            disabled={props.isRunning}
          >
            {t('region.all')}
          </button>
        </div>
        <p className="helper-text">
          {props.scopeSource === 'manual' && props.scope !== 'unknown' && props.scope !== 'all'
            ? t('region.help', { region: t(regionLabelKey(props.scope)) })
            : t('region.helpAll')}
        </p>
      </div>

      <div className="comparison-controls">
        <button
          type="button"
          className={`chip-compact comparison-toggle${props.comparisonOpen ? ' chip-active' : ''}`}
          onClick={props.onToggleComparison}
          aria-expanded={props.comparisonOpen}
          aria-controls="comparison-section"
          disabled={props.isRunning}
        >
          {t('comparisonMode.toggle')}
        </button>
        {props.comparisonOpen ? (
          <div id="comparison-section" className="card card-subtle comparison-section">
            <p className="label-caption">{t('comparisonMode.protocols')}</p>
            <div className="mode-grid">
              {COMPARISON_PROTOCOLS.map((protocol) => {
                const selected = props.comparisonProtocols.includes(protocol)
                return (
                  <button
                    key={protocol}
                    type="button"
                    className={`chip-compact${selected ? ' chip-active' : ''}`}
                    aria-pressed={selected}
                    onClick={() => props.onToggleComparisonProtocol(protocol)}
                    disabled={props.isRunning || props.comparisonActive}
                  >
                    {t(PROTOCOL_LABEL_KEY[protocol])}
                  </button>
                )
              })}
            </div>
            {props.comparisonProtocols.length < 2 ? (
              <p className="helper-text">{t('comparisonMode.selectTwo')}</p>
            ) : props.comparisonPreflightLoading ? (
              <p className="muted">{t('comparisonMode.preflightLoading')}</p>
            ) : props.comparisonPreflightError ? (
              <p className="muted" role="alert">
                {props.comparisonPreflightError}
              </p>
            ) : props.comparisonPreflight ? (
              <div className="comparison-preflight">
                <p>
                  {t('comparisonMode.requestedCount', { count: props.comparisonPreflight.canonical_protocols.length })}
                  {' · '}
                  {t('comparisonMode.commonTargets', {
                    count: props.comparisonPreflight.common_eligible_target_snapshot?.resolver_ips.length ?? 0,
                  })}
                </p>
                {props.comparisonPreflight.exclusions.length > 0 ? (
                  <ul>
                    {props.comparisonPreflight.exclusions.map((exclusion) => (
                      <li key={`${exclusion.resolver}-${exclusion.protocol}`}>
                        {exclusion.resolver} · {t(PROTOCOL_LABEL_KEY[exclusion.protocol])} ·{' '}
                        {t(EXCLUSION_LABEL_KEY[exclusion.code] ?? 'comparisonMode.exclusionReason.unknown')}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!props.comparisonPreflight.admissible ? (
                  <p className="helper-text">
                    {t('comparisonMode.notAdmissible')}{' '}
                    {props.comparisonPreflight.admission_reason_codes
                      .map((code) => t(ADMISSION_LABEL_KEY[code] ?? code))
                      .join(' · ')}
                  </p>
                ) : null}
                <div className="actions-row">
                  <button
                    type="button"
                    className="btn-start"
                    onClick={props.onStartComparison}
                    disabled={!props.comparisonPreflight.admissible || props.comparisonActive}
                  >
                    {t('comparisonMode.start')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
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
