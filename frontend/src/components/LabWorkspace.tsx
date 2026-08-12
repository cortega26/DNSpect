import { lazy, Suspense, useRef, useState, type KeyboardEvent } from 'react'

import { DashboardControls } from '@/components/DashboardControls'
import { DashboardPanel } from '@/components/DashboardPanel'
import { LiveRankingPanel } from '@/components/LiveRankingPanel'
import { RecommendedResolverPanel } from '@/components/RecommendedResolverPanel'
import { ResolverRankingPanel } from '@/components/ResolverRankingPanel'
import { RunComparisonPanel } from '@/components/RunComparisonPanel'
import { RunHistoryPanel } from '@/components/RunHistoryPanel'
import { WatchPanel, type WatchSessionConfig } from '@/components/WatchPanel'
import type { RunHistoryEntry } from '@/lib/api'
import type {
  ProtocolComparisonStatus,
  ResolverResult,
  RunComparisonResponse,
  SystemDnsPayload,
} from '@/lib/types'
import { fmtMs } from '@/lib/utils'
import { useI18n } from '@/lib/useI18n'

const ChartsPanel = lazy(() => import('@/components/ChartsPanel').then((m) => ({ default: m.ChartsPanel })))
const ProtocolComparisonPanel = lazy(() => import('@/components/ProtocolComparisonPanel').then((m) => ({ default: m.ProtocolComparisonPanel })))

export type LabSection = 'benchmark' | 'results' | 'history' | 'watch' | 'protocol'

export interface RunningCardProps {
  healthMessage: string
  progressPct: number
  completedResolvers: number
  totalResolvers: number
  currentResolverLabel: string
  lastProgressLabel: string
  avgLatencyMs: number | null
  etaLabel: string
  results: ResolverResult[]
  runs: number
  currentResolver: string | null
  isRunning: boolean
}

export interface SavedLastRunCard {
  timestampLabel: string
  recommendedLabel: string
  topLatency: string
  topReliability: string
}

export interface LabWorkspaceProps {
  initialSection?: LabSection
  controls: Parameters<typeof DashboardControls>[0]
  doqAvailable: boolean
  runningCard: RunningCardProps | null
  failedError: string | null
  systemDns: SystemDnsPayload | null
  saved: {
    lastRunSummary: SavedLastRunCard | null
    notice: string | null
    viewingSavedRun: boolean
    onViewSavedRun: () => void
    onClearSavedRun: () => void
  }
  results: {
    isCompleted: boolean
    primaryResult: ResolverResult | null
    decisiveRanking: ResolverResult[]
    reliabilityPct: number | null
    improvementVsCurrentMs: number | null
    currentResolverLabel: string
    currentResolverRank: number | null
    recommendationWarning: string | null
    isSmallImprovement: boolean
    showRecommendedPanel: boolean
    viewingWatchRun: boolean
    runOrigin: string | null
    primaryRank: number | null
    copyStatus: 'idle' | 'success' | 'error'
    summaryCopyStatus: 'idle' | 'success' | 'error'
    rankingPanelRef: { current: HTMLElement | null }
    emptyMessage: string
    onSelectResult: (result: ResolverResult) => void
    onApplyRecommended: () => void
    onCopyAddress: () => void
    onCopySummary: () => void
    onExportJson: () => void
    onExportCsv: () => void
    onViewFullRanking: () => void
    searchTerm: string
    onlyReliable: boolean
    isRunning: boolean
    onSearchChange: (value: string) => void
    onOnlyReliableChange: (value: boolean) => void
    filteredResults: ResolverResult[]
    currentDnsEvaluation: { row: ResolverResult; rank: number } | null
    recommendedProviderName: string
  }
  history: {
    runs: RunHistoryEntry[]
    loading: boolean
    baselineId: string | null
    candidateId: string | null
    comparison: RunComparisonResponse | null
    comparisonLoading: boolean
    comparisonError: string | null
    onSelectRun: (runId: string) => void
    onSetBaseline: (runId: string | null) => void
    onSetCandidate: (runId: string | null) => void
    onClearComparison: () => void
  }
  watch: {
    currentSession: WatchSessionConfig | null
    onCompare: (baselineId: string, candidateId: string) => void
  }
  protocol: {
    comparisonId: string | null
    comparison: ProtocolComparisonStatus | null
    loading: boolean
    error: string | null
  }
}

const SECTIONS: LabSection[] = ['benchmark', 'results', 'history', 'watch', 'protocol']

const SECTION_LABEL_KEY: Record<LabSection, 'lab.benchmark' | 'lab.results' | 'lab.history' | 'lab.watch' | 'lab.protocol'> = {
  benchmark: 'lab.benchmark',
  results: 'lab.results',
  history: 'lab.history',
  watch: 'lab.watch',
  protocol: 'lab.protocol',
}

function SectionNav({ active, onSelect }: { active: LabSection; onSelect: (section: LabSection) => void }) {
  const { t } = useI18n()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function select(next: LabSection) {
    onSelect(next)
    tabRefs.current[SECTIONS.indexOf(next)]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      select(SECTIONS[(index + delta + SECTIONS.length) % SECTIONS.length])
    } else if (event.key === 'Home') {
      event.preventDefault()
      select(SECTIONS[0])
    } else if (event.key === 'End') {
      event.preventDefault()
      select(SECTIONS[SECTIONS.length - 1])
    }
  }

  return (
    <nav className="subnav hairline-b" role="tablist" aria-label={t('lab.label')}>
      {SECTIONS.map((section, index) => (
        <button
          key={section}
          ref={(element) => {
            tabRefs.current[index] = element
          }}
          type="button"
          role="tab"
          id={`lab-tab-${section}`}
          aria-selected={active === section}
          aria-controls={`lab-panel-${section}`}
          tabIndex={active === section ? 0 : -1}
          className={`subnav-tab${active === section ? ' is-active' : ''}`}
          onClick={() => onSelect(section)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {t(SECTION_LABEL_KEY[section])}
        </button>
      ))}
    </nav>
  )
}

export function LabWorkspace(props: LabWorkspaceProps) {
  const { t } = useI18n()
  const [section, setSection] = useState<LabSection>(props.initialSection ?? 'benchmark')
  const { controls, saved, results, history, watch, protocol } = props
  const { rankingPanelRef } = results

  return (
    <div className="lab-workspace">
      <SectionNav active={section} onSelect={setSection} />

      {props.runningCard && (
        <section className="card compact status-running fade-in-section">
          <h3 className="section-heading-icon">
            <svg className="icon-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            {t('status.progressPanelTitle')}
          </h3>
          <p className="muted">{props.runningCard.healthMessage}</p>
          <div className="progress-panel progress-panel--live">
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${props.runningCard.progressPct}%` }} />
            </div>
            <p className="progress-percent">{props.runningCard.progressPct}%</p>
            <div className="progress-metrics">
              <p className="metric-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <path d="M22 4L12 14.01l-3-3" />
                </svg>
                {t('status.resolversTested', {
                  tested: props.runningCard.completedResolvers,
                  total: props.runningCard.totalResolvers,
                })}
              </p>
              <p className="progress-current-resolver">
                <span className="progress-current-dot" aria-hidden="true" />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                  <rect x="2" y="2" width="20" height="8" rx="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" />
                  <path d="M6 6h.01M6 18h.01" />
                </svg>
                {props.runningCard.currentResolverLabel}
              </p>
              <p className="metric-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
                {props.runningCard.lastProgressLabel}
              </p>
              <p className="metric-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                {t('status.avgLatencyContext', { latency: fmtMs(props.runningCard.avgLatencyMs) })}
              </p>
              <p className="metric-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 6v6l4 2" />
                </svg>
                {t('status.etaRemaining', { eta: props.runningCard.etaLabel })}
              </p>
            </div>
          </div>
          <LiveRankingPanel
            results={props.runningCard.results}
            expectedSamples={props.runningCard.runs}
            isRunning={props.runningCard.isRunning}
            currentResolver={props.runningCard.currentResolver}
          />
        </section>
      )}

      {props.failedError !== null && (
        <section className="card compact status-error fade-in-section">
          <h3 className="section-heading-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M15 9l-6 6M9 9l6 6" />
            </svg>
            {t('status.errorTitle')}
          </h3>
          <p>{t('status.errorHint', { error: props.failedError })}</p>
        </section>
      )}

      {saved.lastRunSummary && (
        <section className="card compact last-run-card fade-in-section">
          <h3 className="section-heading-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
            {t('lastRun.title')}
          </h3>
          {saved.notice && (
            <p className="section-heading-icon" style={{ color: 'var(--warning)', fontSize: '0.85rem', marginBottom: 'var(--space-2)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" aria-hidden="true">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86l-8.1 14c-.6 1.04.15 2.14 1.21 2.14h16.2c1.06 0 1.71-1.1 1.21-2.14l-8.1-14c-.6-1.04-1.82-1.04-2.42 0z" />
              </svg>
              {saved.notice}
            </p>
          )}
          <p className="muted">{t('lastRun.savedAt', { timestamp: saved.lastRunSummary.timestampLabel })}</p>
          <p>{t('lastRun.recommended', { resolver: saved.lastRunSummary.recommendedLabel })}</p>
          <p>{t('lastRun.topLatency', { latency: saved.lastRunSummary.topLatency })}</p>
          <p>{t('lastRun.topReliability', { reliability: saved.lastRunSummary.topReliability })}</p>
          <div className="actions-row">
            <button type="button" className="btn-secondary" onClick={saved.onViewSavedRun}>
              {t('lastRun.view')}
            </button>
            <button type="button" className="btn-ghost" onClick={saved.onClearSavedRun}>
              {t('lastRun.clear')}
            </button>
          </div>
        </section>
      )}

      {saved.notice && !saved.lastRunSummary && (
        <section className="card compact saved-run-notice fade-in-section" role="status">
          <p className="section-heading-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden="true">
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.29 3.86l-8.1 14c-.6 1.04.15 2.14 1.21 2.14h16.2c1.06 0 1.71-1.1 1.21-2.14l-8.1-14c-.6-1.04-1.82-1.04-2.42 0z" />
            </svg>
            {saved.notice}
          </p>
        </section>
      )}

      {saved.viewingSavedRun && (
        <section className="card compact saved-run-viewing-badge fade-in-section" role="status">
          <h3 className="section-heading-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t('lastRun.viewingSavedTitle')}
          </h3>
          <p>{t('lastRun.viewingSavedBody')}</p>
        </section>
      )}

      <div className="lab-sections">
        {section === 'benchmark' && (
          <div id="lab-panel-benchmark" role="tabpanel" aria-labelledby="lab-tab-benchmark" className="lab-section">
            <DashboardControls {...controls} />

            {props.systemDns && (
              <section className="card compact fade-in-section">
                <h3 className="section-heading-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="8" rx="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" />
                    <path d="M6 6h.01M6 18h.01" />
                  </svg>
                  {t('systemDns.title')}
                </h3>
                <p>
                  {t('systemDns.method')}: <strong>{props.systemDns.method}</strong> | {t('systemDns.platform')}:{' '}
                  <strong>{props.systemDns.platform}</strong>
                </p>
                <p>
                  {props.systemDns.resolvers.length
                    ? props.systemDns.resolvers.join(', ')
                    : t('systemDns.none')}
                </p>
                {props.systemDns.error_detail ? (
                  <p className="muted">{t('systemDns.errorDetail', { error: props.systemDns.error_detail })}</p>
                ) : null}
              </section>
            )}
          </div>
        )}

        {section === 'results' && (
          <div id="lab-panel-results" role="tabpanel" aria-labelledby="lab-tab-results" className="lab-section">
            {results.isCompleted && results.primaryResult && (
              <DashboardPanel
                primaryResult={results.primaryResult}
                results={results.decisiveRanking}
                reliabilityPct={results.reliabilityPct}
                improvementVsCurrentMs={results.improvementVsCurrentMs}
                currentResolverLabel={results.currentResolverLabel}
                currentResolverRank={results.currentResolverRank}
                recommendationWarning={results.recommendationWarning}
                isSmallImprovement={results.isSmallImprovement}
                copyStatus={results.copyStatus}
                summaryCopyStatus={results.summaryCopyStatus}
                onApplyRecommended={results.onApplyRecommended}
                onCopyAddress={results.onCopyAddress}
                onCopySummary={results.onCopySummary}
                onExportJson={results.onExportJson}
                onExportCsv={results.onExportCsv}
                onViewFullRanking={results.onViewFullRanking}
              />
            )}

            {results.isCompleted && results.primaryResult && results.showRecommendedPanel && !results.viewingWatchRun && (
              <RecommendedResolverPanel
                result={results.primaryResult}
                rank={results.primaryRank ?? 1}
                reliabilityPct={results.reliabilityPct}
                improvementVsCurrentMs={results.improvementVsCurrentMs}
                recommendationWarning={results.recommendationWarning}
                isSmallImprovement={results.isSmallImprovement}
                runOrigin={results.runOrigin}
                copyStatus={results.copyStatus}
                summaryCopyStatus={results.summaryCopyStatus}
                onApplyRecommended={results.onApplyRecommended}
                onCopyAddress={results.onCopyAddress}
                onCopySummary={results.onCopySummary}
                onExportJson={results.onExportJson}
                onExportCsv={results.onExportCsv}
                onViewFullRanking={results.onViewFullRanking}
              />
            )}

            {results.isCompleted && (
              <div
                ref={(element) => {
                  rankingPanelRef.current = element
                }}
              >
                <ResolverRankingPanel
                  id="resolver-ranking-panel"
                  results={results.decisiveRanking}
                  emptyMessage={results.emptyMessage}
                  onSelect={results.onSelectResult}
                />
              </div>
            )}

            {results.isCompleted && results.decisiveRanking.length > 0 && (
              <>
                {props.systemDns && (
                  <section className="card compact card-subtle fade-in-section">
                    <h3 className="section-heading-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                      {t('systemDns.evaluationTitle')}
                    </h3>
                    {results.currentDnsEvaluation ? (
                      <>
                        <p className="recommendation-ip">{results.currentDnsEvaluation.row.resolver}</p>
                        <p>
                          {t('systemDns.evaluationLatency', {
                            latency: fmtMs(results.currentDnsEvaluation.row.stats.score_latency),
                          })}
                        </p>
                        <p>{t('systemDns.evaluationRank', { rank: results.currentDnsEvaluation.rank })}</p>
                        <p>
                          {t('systemDns.evaluationRecommendation', {
                            provider: results.recommendedProviderName,
                            resolver: results.primaryResult?.resolver ?? t('summary.na'),
                          })}
                        </p>
                      </>
                    ) : (
                      <p>{t('systemDns.evaluationUnavailable')}</p>
                    )}
                  </section>
                )}

                <section className="card compact card-subtle fade-in-section">
                  <h3 className="section-heading-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" aria-hidden="true">
                      <path d="M3 3v18h18" />
                      <path d="M7 16l4-8 4 4 4-6" />
                    </svg>
                    {t('summary.title')}
                  </h3>
                  <div className="summary-grid">
                    <article className="metric-card" title={t('summary.medianTitle')}>
                      <h4>{t('summary.fast')}</h4>
                      <p>{fmtMs(results.primaryResult?.stats.median_ms ?? null)}</p>
                    </article>
                    <article className="metric-card" title={t('summary.p95Title')}>
                      <h4>{t('summary.stable')}</h4>
                      <p>{fmtMs(results.primaryResult?.stats.p95_ms ?? null)}</p>
                    </article>
                    <article className="metric-card" title={t('summary.reliabilityTitle')}>
                      <h4>{t('summary.reliable')}</h4>
                      <p>{results.reliabilityPct === null ? t('summary.na') : `${results.reliabilityPct.toFixed(0)}%`}</p>
                    </article>
                  </div>
                </section>

                <details className="card compact guide-collapse fade-in-section">
                  <summary className="section-heading-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                    {t('guide.title')}
                  </summary>
                  <p className="helper-text" style={{ marginTop: 'var(--space-2)' }}>{t('guide.line1')}</p>
                  <p className="helper-text">{t('guide.line2')}</p>
                </details>

                <section className="card compact fade-in-section">
                  <h3 className="section-heading-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden="true">
                      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                    </svg>
                    {t('filters.title')}
                  </h3>
                  <div className="filters-grid">
                    <label>
                      {t('filters.searchLabel')}
                      <input
                        type="text"
                        value={results.searchTerm}
                        onChange={(e) => results.onSearchChange(e.target.value)}
                        placeholder={t('filters.searchPlaceholder')}
                        disabled={results.isRunning}
                      />
                    </label>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={results.onlyReliable}
                        disabled={results.isRunning}
                        onChange={(e) => results.onOnlyReliableChange(e.target.checked)}
                      />
                      {t('filters.onlyReliable')}
                    </label>
                  </div>
                </section>

                <Suspense fallback={<section className="card"><p>{t('charts.loading')}</p></section>}>
                  <ChartsPanel results={results.filteredResults} />
                </Suspense>
              </>
            )}
          </div>
        )}

        {section === 'history' && (
          <div id="lab-panel-history" role="tabpanel" aria-labelledby="lab-tab-history" className="lab-section">
            <RunHistoryPanel
              runs={history.runs}
              loading={history.loading}
              onSelectRun={history.onSelectRun}
              baselineId={history.baselineId}
              candidateId={history.candidateId}
              onSetBaseline={history.onSetBaseline}
              onSetCandidate={history.onSetCandidate}
            />

            {history.baselineId && history.candidateId && (
              <RunComparisonPanel
                baselineId={history.baselineId}
                candidateId={history.candidateId}
                comparison={history.comparison}
                loading={history.comparisonLoading}
                error={history.comparisonError}
                onClear={history.onClearComparison}
              />
            )}
          </div>
        )}

        {section === 'watch' && (
          <div id="lab-panel-watch" role="tabpanel" aria-labelledby="lab-tab-watch" className="lab-section">
            <WatchPanel
              doqAvailable={props.doqAvailable}
              running={results.isRunning}
              currentSession={watch.currentSession}
              onCompare={watch.onCompare}
            />
          </div>
        )}

        {section === 'protocol' && (
          <div id="lab-panel-protocol" role="tabpanel" aria-labelledby="lab-tab-protocol" className="lab-section">
            {protocol.comparisonId && (
              <Suspense fallback={null}>
                <ProtocolComparisonPanel
                  comparison={protocol.comparison}
                  loading={protocol.loading}
                  error={protocol.error}
                />
              </Suspense>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
