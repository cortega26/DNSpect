import { expect, test } from '@playwright/test'
import {
  CLOUDFLARE_RESULT,
  MockApi,
  QUAD9_RESULT,
  doneBenchmark,
  makeWatchEntry,
  probeFixture,
  runningBenchmark,
} from './fixtures'

const POST_BENCHMARKS = 'POST /api/benchmarks'
const GET_BENCHMARK = 'GET /api/benchmarks/:id'
const POST_PROBE = 'POST /api/probe'

async function waitForRouteDeferred(api: MockApi, routeKey: string, count: number, timeoutMs = 5_000): Promise<void> {
  await expect
    .poll(() => api.deferredsFor(routeKey).length, { timeout: timeoutMs })
    .toBeGreaterThanOrEqual(count)
}

test.describe('workflow regression floor (Chromium, mocked network)', () => {
  test('cold initialization renders providers and a usable start control', async ({ page }) => {
    const api = new MockApi(page)
    await api.install()
    await page.goto('/')

    const startButton = page.locator('.btn-start')
    await expect(startButton).toBeVisible()
    await expect(startButton).toBeEnabled()

    await expect(page.getByText('3 providers')).toBeVisible()
    await expect(page.getByText('Resolvers included: 7')).toBeVisible()
    await expect(page.getByText('systemd-resolve')).toBeVisible()
    await expect(page.getByRole('paragraph').filter({ hasText: '192.168.1.1' })).toBeVisible()

    expect(api.unhandledRequests).toEqual([])
  })

  test('a rapid double activation produces exactly one start POST', async ({ page }) => {
    const api = new MockApi(page)
    api.on(POST_BENCHMARKS, () => api.deferredFor(POST_BENCHMARKS))
    await api.install()
    await page.goto('/')

    const startButton = page.locator('.btn-start')
    await expect(startButton).toBeEnabled()

    await startButton.click()
    await startButton.click()

    expect(api.countOf(POST_BENCHMARKS)).toBe(1)

    const [startPost] = api.deferredsFor(POST_BENCHMARKS)
    expect(startPost).toBeDefined()
    startPost.resolve({ body: { benchmark_id: 'cafebabe00000000000000000000000001' } })

    await expect(page.locator('.status-running')).toBeVisible()
    expect(api.unhandledRequests).toEqual([])
  })

  test('polling progresses from running to a done ranking without sleeps', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    await api.install()
    await page.goto('/')

    await page.locator('.btn-start').click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 1)
    const [firstPoll] = api.deferredsFor(GET_BENCHMARK)
    const benchmarkId = firstPoll.meta.id
    firstPoll.resolve({ body: runningBenchmark(benchmarkId) })

    await expect(page.locator('.status-running')).toBeVisible()

    await waitForRouteDeferred(api, GET_BENCHMARK, 2)
    const [, secondPoll] = api.deferredsFor(GET_BENCHMARK)
    secondPoll.resolve({ body: doneBenchmark(benchmarkId, CLOUDFLARE_RESULT) })

    await expect(page.locator('.dashboard-hero-ip')).toHaveText('1.1.1.1')
    await expect(page.locator('#resolver-ranking-panel .ranking-row-rank-1 .ranking-line')).toContainText(
      'Cloudflare - 1.1.1.1',
    )
    expect(api.unhandledRequests).toEqual([])
  })

  test('a terminal response stops further polling', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    await api.install()
    await page.goto('/')

    await page.locator('.btn-start').click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 1)
    const [firstPoll] = api.deferredsFor(GET_BENCHMARK)
    firstPoll.resolve({ body: runningBenchmark(firstPoll.meta.id) })
    await expect(page.locator('.status-running')).toBeVisible()

    await waitForRouteDeferred(api, GET_BENCHMARK, 2)
    const [, secondPoll] = api.deferredsFor(GET_BENCHMARK)
    secondPoll.resolve({ body: doneBenchmark(secondPoll.meta.id, CLOUDFLARE_RESULT) })
    await expect(page.locator('#resolver-ranking-panel')).toBeVisible()

    await page.waitForTimeout(2_500)
    expect(api.countOf(GET_BENCHMARK)).toBe(2)
    expect(api.unhandledRequests).toEqual([])
  })

  test('selecting a history run never resumes live polling', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)
    await page.locator('.history-btn', { hasText: 'Quad9' }).click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 1)
    const [selection] = api.deferredsFor(GET_BENCHMARK)
    selection.resolve({ body: doneBenchmark(selection.meta.id, QUAD9_RESULT) })
    await expect(page.locator('.saved-run-viewing-badge')).toBeVisible()

    await page.waitForTimeout(2_500)
    expect(api.countOf(GET_BENCHMARK)).toBe(1)
    await expect(page.locator('.status-running')).toHaveCount(0)
    expect(api.unhandledRequests).toEqual([])
  })

  test('teardown abandons in-flight polling without unhandled requests', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))
    await api.install()
    await page.goto('/')

    await page.locator('.btn-start').click()
    await waitForRouteDeferred(api, GET_BENCHMARK, 1)

    await page.goto('about:blank')

    const [pendingPoll] = api.deferredsFor(GET_BENCHMARK)
    pendingPoll.resolve({ body: runningBenchmark(pendingPoll.meta.id) })

    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
    expect(api.unhandledRequests).toEqual([])
  })

  test('out-of-order history responses cannot overwrite the current selection', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)

    await page.locator('.history-btn', { hasText: 'Cloudflare' }).click()
    await page.locator('.history-btn', { hasText: 'Quad9' }).click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 2)

    const quad9Deferred = api.deferredsFor(GET_BENCHMARK).find((deferred) => deferred.meta.id.includes('bbbb'))
    const cloudflareDeferred = api.deferredsFor(GET_BENCHMARK).find((deferred) => deferred.meta.id.includes('aaaa'))
    expect(quad9Deferred).toBeDefined()
    expect(cloudflareDeferred).toBeDefined()

    quad9Deferred!.resolve({ body: doneBenchmark(quad9Deferred!.meta.id, QUAD9_RESULT) })

    await expect(page.locator('.saved-run-viewing-badge')).toBeVisible()
    await expect(page.locator('#resolver-ranking-panel .ranking-row-rank-1 .ranking-line')).toContainText(
      'Quad9 - 9.9.9.9',
    )

    cloudflareDeferred!.resolve({ body: doneBenchmark(cloudflareDeferred!.meta.id, CLOUDFLARE_RESULT) })

    await expect(page.locator('#resolver-ranking-panel .ranking-row-rank-1 .ranking-line')).toContainText(
      'Quad9 - 9.9.9.9',
    )
    await expect(page.locator('#resolver-ranking-panel .ranking-row-rank-1 .ranking-line')).not.toContainText(
      'Cloudflare - 1.1.1.1',
    )
    expect(api.unhandledRequests).toEqual([])
  })

  test('a superseded sample request cannot show a stale result', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)
    await page.locator('.history-btn', { hasText: 'Quad9' }).click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 1)
    const [selection] = api.deferredsFor(GET_BENCHMARK)
    const runId = selection.meta.id
    selection.resolve({ body: doneBenchmark(runId, QUAD9_RESULT) })

    await expect(page.locator('#resolver-ranking-panel .ranking-row')).toHaveCount(2)

    await page.locator('#resolver-ranking-panel .ranking-row-rank-1 .table-link-btn').click()
    const detailModal = page.locator('[role="dialog"][aria-label*="9.9.9.9"]')
    await expect(detailModal).toBeVisible()
    await detailModal.locator('.samples-callout .btn-primary').click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 2)
    const [, samplesRequest] = api.deferredsFor(GET_BENCHMARK)
    expect(samplesRequest.meta.id).toBe(runId)

    await detailModal.locator('.modal-head button').click()
    await expect(detailModal).toBeHidden()

    await page.locator('#resolver-ranking-panel .ranking-row-rank-2 .table-link-btn').click()
    const otherModal = page.locator('[role="dialog"][aria-label*="8.8.8.8"]')
    await expect(otherModal).toBeVisible()

    samplesRequest.resolve({ body: doneBenchmark(runId, QUAD9_RESULT) })

    await expect(otherModal).toBeVisible()
    await expect(otherModal).not.toContainText('Cloudflare - 1.1.1.1')
    expect(api.unhandledRequests).toEqual([])
  })

  test('a superseded guided verification cannot show a stale outcome', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    api.on(POST_PROBE, () => api.deferredFor(POST_PROBE))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)
    await page.locator('.history-btn', { hasText: 'Quad9' }).click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 1)
    const [selection] = api.deferredsFor(GET_BENCHMARK)
    selection.resolve({ body: doneBenchmark(selection.meta.id, QUAD9_RESULT) })

    await expect(page.locator('.dashboard-panel')).toBeVisible()

    await page.locator('.dashboard-panel .btn-primary').click()
    const guidedModal = page.locator('[role="dialog"][aria-label*="Apply DNS"]')
    await expect(guidedModal).toBeVisible()

    await guidedModal.getByRole('button', { name: 'Verify after change' }).click()
    await waitForRouteDeferred(api, POST_PROBE, 1)

    await guidedModal.locator('.modal-head button').click()
    await expect(guidedModal).toBeHidden()

    await page.locator('.dashboard-panel .btn-primary').click()
    await expect(guidedModal).toBeVisible()
    await guidedModal.getByRole('button', { name: 'Verify after change' }).click()
    await waitForRouteDeferred(api, POST_PROBE, 2)

    const [staleProbe, currentProbe] = api.deferredsFor(POST_PROBE)
    currentProbe.resolve({ body: probeFixture(99.0) })

    await expect(guidedModal.locator('.guided-verification')).toBeVisible()
    await expect(guidedModal.locator('.guided-verification')).toContainText('99.00')

    staleProbe.resolve({ body: probeFixture(12.0) })

    await expect(guidedModal.locator('.guided-verification')).toContainText('99.00')
    await expect(guidedModal.locator('.guided-verification')).not.toContainText('12.00')
    expect(api.unhandledRequests).toEqual([])
  })

  test('watch alert drill-down opens the run comparison panel', async ({ page }) => {
    const api = new MockApi(page)
    api.setWatches([makeWatchEntry()])
    await api.install()
    await page.goto('/')

    const alertBanner = page.locator('.watch-alert-banner')
    await expect(alertBanner).toBeVisible()
    await expect(alertBanner).toContainText('success_rate')
    await expect(alertBanner).toContainText('99.0% → 93.0% (6.0%)')

    await alertBanner.getByRole('button', { name: 'Run comparison' }).click()

    const comparisonPanel = page.locator('.comparison-panel')
    await expect(comparisonPanel).toBeVisible()
    await expect(comparisonPanel).toContainText('Comparable')
    await expect(comparisonPanel).toContainText('Baseline: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa · Candidate: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    await expect(comparisonPanel).toContainText('12.30 ms')
    expect(api.unhandledRequests).toEqual([])
  })
})
