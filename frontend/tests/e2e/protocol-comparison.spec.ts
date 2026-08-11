import { expect, test } from '@playwright/test'
import {
  MockApi,
  protocolComparisonNotAdmissibleFixture,
  protocolComparisonPartialFixture,
  protocolComparisonPreflightFixture,
  protocolComparisonPreflightWithExclusionFixture,
  protocolComparisonStatusFixture,
} from './fixtures'

const PREFLIGHT = 'POST /api/protocol-comparisons/preflight'
const START = 'POST /api/protocol-comparisons'
const GET_STATUS = 'GET /api/protocol-comparisons/:id'

async function waitForRouteDeferred(api: MockApi, routeKey: string, count: number, timeoutMs = 5_000): Promise<void> {
  await expect
    .poll(() => api.deferredsFor(routeKey).length, { timeout: timeoutMs })
    .toBeGreaterThanOrEqual(count)
}

function comparisonPanel(page: import('@playwright/test').Page) {
  return page.locator('.protocol-comparison-panel')
}

async function openComparisonMode(page: import('@playwright/test').Page) {
  const toggle = page.locator('.comparison-toggle')
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page.locator('.comparison-section')).toBeVisible()
}

test.describe('protocol comparison (Chromium, mocked network)', () => {
  test('a preflight with an excluded resolver shows exclusions and enables start', async ({ page }) => {
    const api = new MockApi(page)
    api.on(PREFLIGHT, () => ({ status: 200, contentType: 'application/json', body: protocolComparisonPreflightWithExclusionFixture() }))
    await api.install()
    await page.goto('/')

    await openComparisonMode(page)
    await expect(page.getByText('Compatible resolvers: 2')).toBeVisible()
    await expect(page.getByText('8.20.247.20')).toBeVisible()
    await expect(page.getByText('no DoH URL')).toBeVisible()

    const startButton = page.getByRole('button', { name: 'Start comparison' })
    await expect(startButton).toBeEnabled()
    expect(api.unhandledRequests).toEqual([])
  })

  test('a non-admissible preflight disables the start control', async ({ page }) => {
    const api = new MockApi(page)
    api.on(PREFLIGHT, () => ({ status: 200, contentType: 'application/json', body: protocolComparisonNotAdmissibleFixture() }))
    await api.install()
    await page.goto('/')

    await openComparisonMode(page)
    await expect(page.getByText('Compatible resolvers: 0')).toBeVisible()
    await expect(page.getByText('Cannot start the comparison:')).toBeVisible()
    await expect(page.getByText('no compatible resolvers')).toBeVisible()

    const startButton = page.getByRole('button', { name: 'Start comparison' })
    await expect(startButton).toBeDisabled()
    expect(api.unhandledRequests).toEqual([])
  })

  test('one start POST after preflight and queued/running/done progress', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_STATUS, (params) => api.deferredFor(GET_STATUS, { id: params.id }))
    await api.install()
    await page.goto('/')

    await openComparisonMode(page)
    await expect(page.getByText('Compatible resolvers: 2')).toBeVisible()
    expect(api.countOf(PREFLIGHT)).toBe(1)

    await page.getByRole('button', { name: 'Start comparison' }).click()
    expect(api.countOf(START)).toBe(1)

    await waitForRouteDeferred(api, GET_STATUS, 1)
    const [firstPoll] = api.deferredsFor(GET_STATUS)
    const comparisonId = firstPoll.meta.id
    firstPoll.resolve({ body: protocolComparisonStatusFixture(comparisonId, { status: 'queued' }) })

    await waitForRouteDeferred(api, GET_STATUS, 2)
    const [, secondPoll] = api.deferredsFor(GET_STATUS)
    secondPoll.resolve({ body: protocolComparisonStatusFixture(comparisonId, { status: 'running' }) })
    await expect(comparisonPanel(page)).toContainText('Progress: 60/246')

    await waitForRouteDeferred(api, GET_STATUS, 3)
    const [, , thirdPoll] = api.deferredsFor(GET_STATUS)
    thirdPoll.resolve({ body: protocolComparisonStatusFixture(comparisonId) })

    await expect(comparisonPanel(page)).toBeVisible()
    await expect(comparisonPanel(page)).toContainText('Completed')
    await expect(comparisonPanel(page)).toContainText('Progress: 246/246')
    expect(api.unhandledRequests).toEqual([])
  })

  test('a three-protocol run renders baseline-versus-later delta pairs', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_STATUS, (params) => api.deferredFor(GET_STATUS, { id: params.id }))
    await api.install()
    await page.goto('/')

    await openComparisonMode(page)
    await page.getByRole('button', { name: 'DoH', exact: true }).click()
    await expect(page.getByText('Compatible resolvers: 2')).toBeVisible()

    await page.getByRole('button', { name: 'Start comparison' }).click()
    await waitForRouteDeferred(api, GET_STATUS, 1)
    const [firstPoll] = api.deferredsFor(GET_STATUS)
    const comparisonId = firstPoll.meta.id
    firstPoll.resolve({
      body: protocolComparisonStatusFixture(comparisonId, {
        status: 'done',
        subruns: [
          { protocol: 'udp', status: 'done', complete: true, error: null, results: [] },
          { protocol: 'dot', status: 'done', complete: true, error: null, results: [] },
          { protocol: 'doh', status: 'done', complete: true, error: null, results: [] },
        ],
        deltaPairs: [
          { baseline_protocol: 'udp', candidate_protocol: 'dot', rows: [] },
          { baseline_protocol: 'udp', candidate_protocol: 'doh', rows: [] },
        ],
      }),
    })

    const panel = comparisonPanel(page)
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('UDP → DoT')
    await expect(panel).toContainText('UDP → DoH')
    expect(api.unhandledRequests).toEqual([])
  })

  test('a partial subrun keeps its resolver row with unavailable markers and null deltas', async ({ page }) => {
    const api = new MockApi(page)
    api.on(GET_STATUS, (params) => api.deferredFor(GET_STATUS, { id: params.id }))
    await api.install()
    await page.goto('/')

    await openComparisonMode(page)
    await expect(page.getByText('Compatible resolvers: 2')).toBeVisible()
    await page.getByRole('button', { name: 'Start comparison' }).click()

    await waitForRouteDeferred(api, GET_STATUS, 1)
    const [firstPoll] = api.deferredsFor(GET_STATUS)
    firstPoll.resolve({ body: protocolComparisonPartialFixture(firstPoll.meta.id) })

    const panel = comparisonPanel(page)
    await expect(panel).toContainText('Partially completed')
    await expect(panel).toContainText('dot transport exploded')

    const udpDotPair = panel.locator('details', { hasText: 'UDP → DoT' })
    await expect(udpDotPair).toContainText('9.9.9.9')
    await expect(udpDotPair).toContainText('no data')
    await expect(udpDotPair).toContainText('unavailable')
    await expect(udpDotPair).toContainText('-0.80 ms')
    expect(api.unhandledRequests).toEqual([])
  })

  test('a late old-parent or old-preflight response cannot replace a newer one', async ({ page }) => {
    const api = new MockApi(page)
    api.on(PREFLIGHT, () => api.deferredFor(PREFLIGHT))
    api.on(GET_STATUS, (params) => api.deferredFor(GET_STATUS, { id: params.id }))
    await api.install()
    await page.goto('/')

    await openComparisonMode(page)
    await waitForRouteDeferred(api, PREFLIGHT, 1)

    await page.getByRole('button', { name: 'DoH', exact: true }).click()
    await waitForRouteDeferred(api, PREFLIGHT, 2)

    const [oldPreflight, newPreflight] = api.deferredsFor(PREFLIGHT)
    newPreflight.resolve({ body: protocolComparisonPreflightFixture({ canonical_protocols: ['udp', 'dot', 'doh'] }) })
    await expect(page.getByText('Requested: 3 protocols')).toBeVisible()
    oldPreflight.resolve({ body: protocolComparisonPreflightFixture() })
    await expect(page.getByText('Requested: 3 protocols')).toBeVisible()
    await expect(page.getByText('Requested: 2 protocols')).toHaveCount(0)

    await page.getByRole('button', { name: 'Start comparison' }).click()
    await waitForRouteDeferred(api, GET_STATUS, 1)
    const [oldParent] = api.deferredsFor(GET_STATUS)
    oldParent.resolve({ body: protocolComparisonStatusFixture(oldParent.meta.id, { status: 'done' }) })
    await expect(comparisonPanel(page)).toContainText('Completed')

    await page.getByRole('button', { name: 'Start comparison' }).click()
    await waitForRouteDeferred(api, GET_STATUS, 2)
    const [staleParent, currentParent] = api.deferredsFor(GET_STATUS)
    currentParent.resolve({ body: protocolComparisonStatusFixture(currentParent.meta.id, { status: 'running' }) })
    await expect(comparisonPanel(page)).toContainText(`Progress: 60/246`)
    staleParent.resolve({ body: protocolComparisonStatusFixture(staleParent.meta.id, { status: 'done' }) })
    await expect(comparisonPanel(page)).toContainText('Progress: 60/246')
    expect(api.unhandledRequests).toEqual([])
  })
})
