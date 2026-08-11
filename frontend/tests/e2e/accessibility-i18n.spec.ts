import { expect, test } from '@playwright/test'
import { doneBenchmark, MockApi, QUAD9_RESULT } from './fixtures'

const GET_BENCHMARK = 'GET /api/benchmarks/:id'
const GET_PROVIDERS = 'GET /api/providers'
const GET_SYSTEM_DNS = 'GET /api/dns/system'

async function waitForRouteDeferred(api: MockApi, routeKey: string, count: number, timeoutMs = 5_000): Promise<void> {
  await expect
    .poll(() => api.deferredsFor(routeKey).length, { timeout: timeoutMs })
    .toBeGreaterThanOrEqual(count)
}

async function htmlLang(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => document.documentElement.lang)
}

test.describe('accessibility and i18n contract', () => {
  test('a saved English locale drives the document language and UI copy', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dnspect-language', 'en')
    })
    const api = new MockApi(page)
    await api.install()
    await page.goto('/')

    await expect(page.locator('.btn-start')).toBeVisible()
    expect(await htmlLang(page)).toBe('en')
    await expect(page.getByText('History')).toBeVisible()
    await expect(page.locator('.chip-compact', { hasText: 'South America' })).toBeVisible()
    expect(api.unhandledRequests).toEqual([])
  })

  test('the loading indicator carries the localized label', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dnspect-language', 'en')
    })
    const api = new MockApi(page)
    api.on(GET_PROVIDERS, () => api.deferredFor(GET_PROVIDERS))
    api.on(GET_SYSTEM_DNS, () => api.deferredFor(GET_SYSTEM_DNS))
    await api.install()
    await page.goto('/')

    await expect(page.locator('[aria-label="Loading"]').first()).toBeVisible()

    for (const deferred of api.deferredsFor(GET_PROVIDERS)) {
      deferred.resolve({ body: [] })
    }
    for (const deferred of api.deferredsFor(GET_SYSTEM_DNS)) {
      deferred.resolve({ body: { resolvers: [], method: 'test', platform: 'test', detected_provider_id: 'isp-detectado' } })
    }
    await expect(page.locator('.btn-start')).toBeVisible()
    expect(api.unhandledRequests).toEqual([])
  })

  test.describe('browser Portuguese locale', () => {
    test.use({ locale: 'pt-BR' })

    test('a browser Portuguese locale is applied without a saved value', async ({ page }) => {
      const api = new MockApi(page)
      await api.install()
      await page.goto('/')

      await expect(page.locator('.btn-start')).toBeVisible()
      expect(await htmlLang(page)).toBe('pt')
      await expect(page.getByText('Histórico')).toBeVisible()
      expect(api.unhandledRequests).toEqual([])
    })
  })

  test('switching locale through the keyboard menu updates the document language', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dnspect-language', 'en')
    })
    const api = new MockApi(page)
    await api.install()
    await page.goto('/')

    const trigger = page.locator('.locale-trigger')
    await expect(trigger).toBeVisible()
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.locale-item:focus')).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    expect(await htmlLang(page)).toBe('pt')
    await expect(page.getByText('Histórico')).toBeVisible()
    expect(api.unhandledRequests).toEqual([])
  })

  test('the skip link moves keyboard focus past the header', async ({ page }) => {
    const api = new MockApi(page)
    await api.install()
    await page.goto('/')

    await page.keyboard.press('Tab')
    const skipFocused = await page.evaluate(() => document.activeElement?.classList.contains('skip-link'))
    expect(skipFocused).toBe(true)

    await page.keyboard.press('Enter')
    const mainFocused = await page.evaluate(() => document.activeElement?.id === 'main-content')
    expect(mainFocused).toBe(true)

    await page.keyboard.press('Tab')
    const focusInfo = await page.evaluate(() => {
      const active = document.activeElement
      const main = document.getElementById('main-content')
      return {
        inMain: active !== null && main !== null && main.contains(active),
        isThemeToggle: active?.classList.contains('theme-toggle') ?? false,
      }
    })
    expect(focusInfo.isThemeToggle).toBe(false)
    expect(focusInfo.inMain).toBe(true)
    expect(api.unhandledRequests).toEqual([])
  })

  test('ranking, chart, and provider-note copy follow the active language', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dnspect-language', 'en')
    })
    const api = new MockApi(page)
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    await api.install()
    await page.goto('/')

    await expect(page.locator('.history-btn')).toHaveCount(2)
    await page.locator('.history-btn', { hasText: 'Quad9' }).click()

    await waitForRouteDeferred(api, GET_BENCHMARK, 1)
    const [selection] = api.deferredsFor(GET_BENCHMARK)
    const body = structuredClone(doneBenchmark(selection.meta.id, QUAD9_RESULT))
    body.results?.forEach((row) => {
      row.stats.failure_rate = 0.05
      row.stats.failure_count = 1
    })
    selection.resolve({ body })

    await expect(page.locator('#resolver-ranking-panel')).toBeVisible()

    const rankingMeta = page.locator('.ranking-meta').first()
    await expect(rankingMeta).toContainText('Score')
    await expect(rankingMeta).not.toContainText('Puntuación')

    await page.locator('.recharts-wrapper').first().hover()
    await expect(page.getByText('Failure rate: 5.0%')).toBeVisible()

    await page.locator('#resolver-ranking-panel .ranking-row-rank-1 .table-link-btn').click()
    const modal = page.locator('[role="dialog"][aria-label*="9.9.9.9"]')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('This provider description is only available in Spanish.')
    await expect(modal).not.toContainText('Prioriza bloqueo de dominios maliciosos.')
    expect(api.unhandledRequests).toEqual([])
  })
})
