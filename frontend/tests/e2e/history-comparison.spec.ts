import { expect, test } from '@playwright/test'
import {
  BASELINE_RUN_ID,
  CANDIDATE_RUN_ID,
  comparableComparisonResponse,
  historyEntry,
  manifestMissingComparisonResponse,
  MockApi,
  nonComparableComparisonResponse,
} from './fixtures'

const GET_HISTORY = 'GET /api/benchmarks/history'
const GET_COMPARE = 'GET /api/benchmarks/compare'

const RUN_C_ID = 'cccccccccccccccccccccccccccccccc'

async function waitForRouteDeferred(api: MockApi, routeKey: string, count: number, timeoutMs = 5_000): Promise<void> {
  await expect
    .poll(() => api.deferredsFor(routeKey).length, { timeout: timeoutMs })
    .toBeGreaterThanOrEqual(count)
}

function comparisonPanel(page: import('@playwright/test').Page) {
  return page.locator('.comparison-panel')
}

async function selectPair(page: import('@playwright/test').Page, baselineLabel: string, candidateLabel: string) {
  await page.getByRole('button', { name: baselineLabel }).click()
  await page.getByRole('button', { name: candidateLabel }).click()
}

test.describe('run history comparison (Chromium, mocked network)', () => {
  test('two compatible runs render deterministic paired deltas', async ({ page }) => {
    const api = new MockApi(page)
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)
    await selectPair(page, 'Use 1.1.1.1 as baseline', 'Use 9.9.9.9 as candidate')

    const panel = comparisonPanel(page)
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Comparable')
    await expect(panel).toContainText(`Baseline: ${BASELINE_RUN_ID}`)
    await expect(panel).toContainText(`Candidate: ${CANDIDATE_RUN_ID}`)

    const cloudflareRow = panel.locator('details', { has: page.locator('summary', { hasText: '1.1.1.1' }) })
    await expect(cloudflareRow).toContainText('Rank: 1 → 2')
    await expect(cloudflareRow).toContainText('+2.90 ms')
    await expect(cloudflareRow).toContainText('+0.04')
    await expect(cloudflareRow).toContainText('+1')

    const quad9Row = panel.locator('details', { has: page.locator('summary', { hasText: '9.9.9.9' }) })
    await expect(quad9Row).toContainText('Rank: 2 → 1')
    await expect(quad9Row).toContainText('-6.30 ms')
    await expect(quad9Row).toContainText('-1')
    expect(api.unhandledRequests).toEqual([])
  })

  test('a manifest mismatch renders ordered reason codes and no deltas', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_COMPARE, () => ({ status: 200, contentType: 'application/json', body: nonComparableComparisonResponse() }))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)
    await selectPair(page, 'Use 1.1.1.1 as baseline', 'Use 9.9.9.9 as candidate')

    const panel = comparisonPanel(page)
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Not comparable')
    await expect(panel).not.toContainText('Rank:')

    const reasonItems = panel.locator('ol li')
    await expect(reasonItems).toHaveCount(3)
    await expect(reasonItems.nth(0)).toHaveText('Different resolver set')
    await expect(reasonItems.nth(1)).toHaveText('Different protocol')
    await expect(reasonItems.nth(2)).toHaveText('Different scoring profile')
    await expect(panel.locator('table')).toHaveCount(0)
    expect(api.unhandledRequests).toEqual([])
  })

  test('a deferred response for an old pair cannot overwrite a newer pair', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_HISTORY, () => ({
      status: 200,
      contentType: 'application/json',
      body: {
        runs: [
          historyEntry(BASELINE_RUN_ID, '1.1.1.1', 'Cloudflare', new Date(Date.now() - 3600_000).toISOString()),
          historyEntry(CANDIDATE_RUN_ID, '9.9.9.9', 'Quad9', new Date(Date.now() - 7200_000).toISOString()),
          historyEntry(RUN_C_ID, '208.67.222.222', 'OpenDNS', new Date(Date.now() - 10_800_000).toISOString()),
        ],
      },
    }))
    api.on(GET_COMPARE, () => api.deferredFor(GET_COMPARE))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(3)
    await selectPair(page, 'Use 1.1.1.1 as baseline', 'Use 9.9.9.9 as candidate')
    await waitForRouteDeferred(api, GET_COMPARE, 1)

    await page.getByRole('button', { name: 'Use 208.67.222.222 as candidate' }).click()
    await waitForRouteDeferred(api, GET_COMPARE, 2)

    const [stalePair, currentPair] = api.deferredsFor(GET_COMPARE)
    const currentBody = structuredClone(comparableComparisonResponse())
    currentBody.candidate_id = RUN_C_ID
    currentPair.resolve({ body: currentBody })

    await expect(comparisonPanel(page)).toContainText(`Candidate: ${RUN_C_ID}`)
    await expect(comparisonPanel(page)).not.toContainText(`Candidate: ${CANDIDATE_RUN_ID}`)

    stalePair.resolve({ body: comparableComparisonResponse() })

    await expect(comparisonPanel(page)).toContainText(`Candidate: ${RUN_C_ID}`)
    await expect(comparisonPanel(page)).not.toContainText(`Candidate: ${CANDIDATE_RUN_ID}`)
    expect(api.unhandledRequests).toEqual([])
  })

  test('a legacy run without a manifest shows a translated explanation, not an error', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_COMPARE, () => ({ status: 200, contentType: 'application/json', body: manifestMissingComparisonResponse() }))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)
    await selectPair(page, 'Use 1.1.1.1 as baseline', 'Use 9.9.9.9 as candidate')

    const panel = comparisonPanel(page)
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Manifest missing')
    await expect(panel).toContainText('The manifest of this run is not available.')
    await expect(panel).toContainText(BASELINE_RUN_ID)
    await expect(panel.locator('.error-box')).toHaveCount(0)
    await expect(panel.locator('table')).toHaveCount(0)
    expect(api.unhandledRequests).toEqual([])
  })
})
