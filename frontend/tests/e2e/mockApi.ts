import type { Page, Route } from '@playwright/test'

import type { RunHistoryEntry } from '../../src/lib/api'
import type { WatchEntry } from '../../src/lib/types'

import { providersFixture } from './catalog'
import {
  comparableComparisonResponse,
  geoIpFixture,
  historyEntry,
  probeFixture,
  protocolComparisonPreflightFixture,
  protocolComparisonStatusFixture,
  publicIpFixture,
  runningBenchmark,
  systemDnsFixture,
} from './fixtureBuilders'

const envOrigin = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env
  ?.DNSPECT_E2E_ORIGIN

export const APP_ORIGIN = envOrigin ?? 'http://127.0.0.1:5173'

export const PUBLIC_IP_HOST = 'api.ipify.org'

export const JSON_TYPE = 'application/json'

export interface JsonResponse {
  status?: number
  contentType?: string
  body: unknown
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export interface RouteDeferred extends Deferred<JsonResponse> {
  routeKey: string
  meta: Record<string, string>
}

function isDeferred(value: JsonResponse | Deferred<JsonResponse>): value is Deferred<JsonResponse> {
  return typeof (value as Deferred<JsonResponse>).promise === 'object'
}

function json(body: unknown): JsonResponse {
  return { status: 200, contentType: JSON_TYPE, body }
}

function csv(body: string): JsonResponse {
  return { status: 200, contentType: 'text/csv', body }
}

// ---- Request dispatcher ----------------------------------------------------------

type Handler = (params: Record<string, string>) => JsonResponse | Deferred<JsonResponse>

let benchSeq = 0

const newBenchmarkId = (): string => {
  benchSeq += 1
  return `cafebabe${benchSeq.toString(16).padStart(24, '0')}`
}

let comparisonSeq = 0

const newComparisonId = (): string => {
  comparisonSeq += 1
  return `deadbeef${comparisonSeq.toString(16).padStart(24, '0')}`
}

let watchListFixture: WatchEntry[] = []

export class MockApi {
  readonly page: Page
  readonly unhandledRequests: string[] = []
  private readonly handlers = new Map<string, Handler>()
  private readonly counters = new Map<string, number>()
  private readonly deferredList = new Map<string, RouteDeferred[]>()
  private readonly routeDeferreds: RouteDeferred[] = []

  constructor(page: Page) {
    this.page = page
    this.setDefaults()
  }

  /** Seed the watch list fixture that the GET /api/watch handler serves. */
  setWatches(watches: WatchEntry[]): void {
    watchListFixture = watches
  }

  private setDefaults(): void {
    this.handlers.set('GET /api/providers', () => json(providersFixture))
    this.handlers.set('GET /api/dns/system', () => json(systemDnsFixture))
    this.handlers.set('GET /api/benchmarks/history', () => json({ runs: [this.historyRunA(), this.historyRunB()] }))
    this.handlers.set('POST /api/benchmarks', () => json({ benchmark_id: newBenchmarkId() }))
    this.handlers.set('GET /api/benchmarks/compare', () => json(comparableComparisonResponse()))
    this.handlers.set('GET /api/benchmarks/:id', (params) => json(runningBenchmark(params.id)))
    this.handlers.set('GET /api/benchmarks/:id/export.csv', () => csv('resolver,provider_name,score_total\n1.1.1.1,Cloudflare,0.97\n'))
    this.handlers.set('POST /api/protocol-comparisons/preflight', () => json(protocolComparisonPreflightFixture()))
    this.handlers.set('POST /api/protocol-comparisons', () => json({ comparison_id: newComparisonId() }))
    this.handlers.set('GET /api/protocol-comparisons/:id', (params) => json(protocolComparisonStatusFixture(params.id, { status: 'running' })))
    this.handlers.set('POST /api/probe', () => json(probeFixture()))
    this.handlers.set('GET /api/geoip', () => json(geoIpFixture))
    this.handlers.set('GET /api/health', () => json({ status: 'ok', version: '1.3.0', backend_time_utc: '2026-08-11T00:00:00Z', capabilities: { doq: false } }))
    this.handlers.set('GET /api/watch', () => json({ watches: watchListFixture }))
    this.handlers.set('GET https://api.ipify.org/', () => json(publicIpFixture))
    this.handlers.set('GET https://fonts.googleapis.com/css', () => ({
      status: 200,
      contentType: 'text/css',
      body: '',
    }))
    this.handlers.set('GET https://fonts.gstatic.com/font', () => ({
      status: 404,
      contentType: 'text/plain',
      body: 'font mocked off',
    }))
  }

  private historyRunA(): RunHistoryEntry {
    return historyEntry('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '1.1.1.1', 'Cloudflare', new Date(Date.now() - 3600_000).toISOString())
  }

  private historyRunB(): RunHistoryEntry {
    return historyEntry('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '9.9.9.9', 'Quad9', new Date(Date.now() - 7200_000).toISOString())
  }

  async install(): Promise<void> {
    await this.page.route('**/*', (route) => this.dispatch(route))
  }

  on(routeKey: string, handler: Handler): void {
    this.handlers.set(routeKey, handler)
  }

  /** Create a controlled deferred response for a route; resolved by the test. */
  deferredFor(routeKey: string, meta: Record<string, string> = {}): RouteDeferred {
    const deferred = Object.assign(createDeferred<JsonResponse>(), { routeKey, meta })
    const list = this.deferredList.get(routeKey) ?? []
    list.push(deferred)
    this.deferredList.set(routeKey, list)
    this.routeDeferreds.push(deferred)
    return deferred
  }

  deferredsFor(routeKey: string): RouteDeferred[] {
    return this.deferredList.get(routeKey) ?? []
  }

  countOf(routeKey: string): number {
    return this.counters.get(routeKey) ?? 0
  }

  get allDeferreds(): RouteDeferred[] {
    return this.routeDeferreds
  }

  private count(routeKey: string): void {
    this.counters.set(routeKey, (this.counters.get(routeKey) ?? 0) + 1)
  }

  private async dispatch(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()

    if (url.hostname === PUBLIC_IP_HOST) {
      await this.fulfillOrFail(route, 'GET https://api.ipify.org/', url.pathname, method, {})
      return
    }

    if (url.hostname === 'fonts.googleapis.com') {
      await this.fulfillOrFail(route, 'GET https://fonts.googleapis.com/css', url.pathname, method, {})
      return
    }

    if (url.hostname === 'fonts.gstatic.com') {
      await this.fulfillOrFail(route, 'GET https://fonts.gstatic.com/font', url.pathname, method, {})
      return
    }

    if (!url.pathname.startsWith('/api/')) {
      if (url.origin === APP_ORIGIN) {
        await route.continue()
      } else {
        this.unhandledRequests.push(`${method} ${url.href}`)
        await route.fulfill({ status: 500, contentType: JSON_TYPE, body: JSON.stringify({ error: 'unhandled-external-request' }) })
      }
      return
    }

    const matched = this.resolveKey(method, url.pathname)
    if (!matched) {
      this.unhandledRequests.push(`${method} ${url.pathname}`)
      await route.fulfill({ status: 500, contentType: JSON_TYPE, body: JSON.stringify({ error: 'unhandled-request' }) })
      return
    }
    await this.fulfillOrFail(route, matched.key, url.pathname, method, matched.params)
  }

  private async fulfillOrFail(
    route: Route,
    routeKey: string,
    pathname: string,
    method: string,
    params: Record<string, string>,
  ): Promise<void> {
    const handler = this.handlers.get(routeKey)
    if (!handler) {
      this.unhandledRequests.push(`${method} ${pathname}`)
      await route.fulfill({ status: 500, contentType: JSON_TYPE, body: JSON.stringify({ error: 'unhandled-request' }) })
      return
    }
    this.count(routeKey)
    const result = handler(params)
    const response = isDeferred(result) ? await result.promise : result
    const status = response.status ?? 200
    const contentType = response.contentType ?? JSON_TYPE
    const body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
    await route.fulfill({ status, contentType, body })
  }

  private resolveKey(method: string, pathname: string): { key: string; params: Record<string, string> } | null {
    const exact = `${method} ${pathname}`
    if (this.handlers.has(exact)) return { key: exact, params: {} }
    for (const key of this.handlers.keys()) {
      if (!key.startsWith(`${method} `)) continue
      const pattern = key.slice(method.length + 1)
      const patternSegments = pattern.split('/')
      const pathSegments = pathname.split('/')
      if (patternSegments.length !== pathSegments.length) continue
      const params: Record<string, string> = {}
      let matches = true
      for (let i = 0; i < patternSegments.length; i += 1) {
        const segment = patternSegments[i]
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(pathSegments[i])
        } else if (segment !== pathSegments[i]) {
          matches = false
          break
        }
      }
      if (matches) return { key, params }
    }
    return null
  }
}
