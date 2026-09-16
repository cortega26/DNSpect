import { expect, test } from '@playwright/test'
import {
  CLOUDFLARE_RESULT,
  MockApi,
  doneBenchmark,
  makeResult,
  runningBenchmark,
} from './fixtures'

const POST_BENCHMARKS = 'POST /api/benchmarks'
const GET_BENCHMARK = 'GET /api/benchmarks/:id'

async function waitForRouteDeferred(api: MockApi, routeKey: string, count: number, timeoutMs = 5_000): Promise<void> {
  await expect
    .poll(() => api.deferredsFor(routeKey).length, { timeout: timeoutMs })
    .toBeGreaterThanOrEqual(count)
}

interface ThemeSnapshot {
  bodyBg: string
  bodyInk: string
  cardBg: string
  activeBg: string
  activeColor: string
  primaryBg: string
  primaryColor: string
}

async function readThemeSnapshot(page: import('@playwright/test').Page): Promise<ThemeSnapshot> {
  return page.evaluate(() => {
    const styleOf = (selector: string): CSSStyleDeclaration | null => {
      const element = selector === 'body' ? document.body : document.querySelector(selector)
      return element ? window.getComputedStyle(element) : null
    }
    const value = (selector: string, property: 'backgroundColor' | 'color'): string =>
      styleOf(selector)?.[property] ?? 'missing'
    return {
      bodyBg: value('body', 'backgroundColor'),
      bodyInk: value('body', 'color'),
      cardBg: value('.verdict-card', 'backgroundColor'),
      activeBg: value('.mode-tab.is-active', 'backgroundColor'),
      activeColor: value('.mode-tab.is-active', 'color'),
      primaryBg: value('.verdict-card .btn-primary', 'backgroundColor'),
      primaryColor: value('.verdict-card .btn-primary', 'color'),
    }
  })
}

test.describe('dual-theme token contract (plan 048)', () => {
  test('dark and light themes render the pinned instrument values', async ({ page }) => {
    const api = new MockApi(page)
    api.on(POST_BENCHMARKS, () => api.deferredFor(POST_BENCHMARKS))
    api.on(GET_BENCHMARK, (params) => api.deferredFor(GET_BENCHMARK, { id: params.id }))
    await api.install()
    await page.goto('/')

    // Drive Quick check to a done verdict so the verdict card and the
    // amber primary button exist in both themes (copy-tolerant: no text
    // assertions, only stable regions).
    await page.getByRole('button', { name: 'Check my DNS' }).click()

    const [startPost] = api.deferredsFor(POST_BENCHMARKS)
    startPost.resolve({ body: { benchmark_id: 'cafebabe00000000000000000000000001' } })

    await waitForRouteDeferred(api, GET_BENCHMARK, 1)
    const [firstPoll] = api.deferredsFor(GET_BENCHMARK)
    firstPoll.resolve({ body: runningBenchmark(firstPoll.meta.id) })

    await waitForRouteDeferred(api, GET_BENCHMARK, 2)
    const [, secondPoll] = api.deferredsFor(GET_BENCHMARK)
    const done = doneBenchmark(secondPoll.meta.id, CLOUDFLARE_RESULT)
    done.results = [...(done.results ?? []), makeResult('192.168.1.1', 'isp-detectado', 'ISP (Detectado)', 42.0)]
    secondPoll.resolve({ body: done })

    const verdict = page.locator('.verdict-card')
    await expect(verdict).toBeVisible()

    // .mode-tab.is-active transitions background/color over 120ms, so let
    // the flip settle before snapshotting computed styles.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await page.waitForTimeout(250)
    await expect(await readThemeSnapshot(page)).toEqual({
      bodyBg: 'rgb(11, 14, 19)',
      bodyInk: 'rgb(230, 234, 241)',
      cardBg: 'rgb(18, 22, 29)',
      activeBg: 'rgb(95, 201, 214)',
      activeColor: 'rgb(11, 14, 19)',
      primaryBg: 'rgb(232, 163, 61)',
      primaryColor: 'rgb(11, 14, 19)',
    })

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    await page.waitForTimeout(250)
    // NOTE (plan 048): body renders var(--bg), whose light value (#F5F6F8)
    // is one digit off the --chassis paper (#F4F5F7) — this is the plan's
    // "rgb(244, 245, 247)-class paper" hedge pinned to its exact value, so
    // any move of either token fails loudly (see maintenance note).
    await expect(await readThemeSnapshot(page)).toEqual({
      bodyBg: 'rgb(245, 246, 248)',
      bodyInk: 'rgb(26, 33, 43)',
      cardBg: 'rgb(255, 255, 255)',
      activeBg: 'rgb(15, 124, 140)',
      activeColor: 'rgb(255, 255, 255)',
      primaryBg: 'rgb(232, 163, 61)',
      primaryColor: 'rgb(11, 14, 19)',
    })

    expect(api.unhandledRequests).toEqual([])
  })
})
