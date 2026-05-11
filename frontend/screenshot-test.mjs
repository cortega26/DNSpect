import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const OUT = '/home/carlos/VS_Code_Projects/DNS_app/frontend/screenshots'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  })

  // ---- 1. LIGHT MODE - INITIAL STATE ----
  {
    const page = await context.newPage()
    // Mock providers response
    await page.route('**/api/providers', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providers) })
    })
    // Mock system DNS
    await page.route('**/api/dns/system', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        resolvers: ['192.168.1.1', '8.8.8.8'],
        method: 'systemd-resolve',
        platform: 'Linux (Mint)',
        error_detail: null,
        detected_provider_id: 'isp-detectado',
      })})
    })
    // Mock GeoIP
    await page.route('**/api/geoip*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ip: '190.0.0.1',
        country_code: 'CO',
        country_name: 'Colombia',
        continent: 'South America',
      })})
    })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/01-light-initial.png`, fullPage: true })
    console.log('✓ 01-light-initial.png')
    await page.close()
  }

  // ---- 2. DARK MODE - INITIAL STATE ----
  {
    const page = await context.newPage()
    await page.route('**/api/providers', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providers) })
    })
    await page.route('**/api/dns/system', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        resolvers: ['192.168.1.1', '8.8.8.8'],
        method: 'systemd-resolve',
        platform: 'Linux (Mint)',
        error_detail: null,
        detected_provider_id: 'isp-detectado',
      })})
    })
    await page.route('**/api/geoip*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ip: '190.0.0.1', country_code: 'CO', country_name: 'Colombia', continent: 'South America',
      })})
    })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    // Toggle dark mode
    const themeBtn = page.locator('.theme-toggle')
    await themeBtn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/02-dark-initial.png`, fullPage: true })
    console.log('✓ 02-dark-initial.png')
    await page.close()
  }

  // ---- 3. ADVANCED CONTROLS EXPANDED ----
  {
    const page = await context.newPage()
    await page.route('**/api/providers', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providers) })
    })
    await page.route('**/api/dns/system', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        resolvers: ['192.168.1.1'], method: 'systemd-resolve', platform: 'Linux (Mint)',
        error_detail: null, detected_provider_id: 'isp-detectado',
      })})
    })
    await page.route('**/api/geoip*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ip: '190.0.0.1', country_code: 'CO', country_name: 'Colombia', continent: 'South America',
      })})
    })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    // Click advanced toggle
    const advBtn = page.locator('.advanced-toggle-link')
    await advBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/03-dark-advanced.png`, fullPage: true })
    console.log('✓ 03-dark-advanced.png')
    await page.close()
  }

  // ---- 4. BENCHMARK RUNNING STATE (mock) ----
  {
    const page = await context.newPage()
    await page.route('**/api/providers', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providers) })
    })
    await page.route('**/api/dns/system', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        resolvers: ['192.168.1.1'], method: 'systemd-resolve', platform: 'Linux (Mint)',
        error_detail: null, detected_provider_id: 'isp-detectado',
      })})
    })
    await page.route('**/api/geoip*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ip: '190.0.0.1', country_code: 'CO', country_name: 'Colombia', continent: 'South America',
      })})
    })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    // Toggle dark mode
    await page.locator('.theme-toggle').click()
    await page.waitForTimeout(300)

    // Inject benchmark running state via React state simulation
    // We'll mock the API endpoint and trigger a start
    // Set up mock for benchmark POST and GET
    const benchmarkId = 'test-bench-001'
    await page.route('**/api/benchmarks', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ benchmark_id: benchmarkId }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runningState) })
      }
    })
    // Click start button
    const startBtn = page.locator('.btn-start')
    await startBtn.click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}/04-dark-running.png`, fullPage: true })
    console.log('✓ 04-dark-running.png')
    await page.close()
  }

  // ---- 5. COMPLETED BENCHMARK RESULTS ----
  {
    const page = await context.newPage()
    await page.route('**/api/providers', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providers) })
    })
    await page.route('**/api/dns/system', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        resolvers: ['192.168.1.1', '8.8.8.8'], method: 'systemd-resolve', platform: 'Linux (Mint)',
        error_detail: null, detected_provider_id: 'isp-detectado',
      })})
    })
    await page.route('**/api/geoip*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ip: '190.0.0.1', country_code: 'CO', country_name: 'Colombia', continent: 'South America',
      })})
    })
    await page.route('**/api/benchmarks', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ benchmark_id: 'test-bench-002' }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(completedState) })
      }
    })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    // Dark mode
    await page.locator('.theme-toggle').click()
    await page.waitForTimeout(300)

    // Click start
    await page.locator('.btn-start').click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}/05-dark-completed.png`, fullPage: true })
    console.log('✓ 05-dark-completed.png')
    await page.close()
  }

  // ---- 6. LIGHT MODE - COMPLETED RESULTS ----
  {
    const page = await context.newPage()
    await page.route('**/api/providers', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providers) })
    })
    await page.route('**/api/dns/system', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        resolvers: ['192.168.1.1', '8.8.8.8'], method: 'systemd-resolve', platform: 'Linux (Mint)',
        error_detail: null, detected_provider_id: 'isp-detectado',
      })})
    })
    await page.route('**/api/geoip*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ip: '190.0.0.1', country_code: 'CO', country_name: 'Colombia', continent: 'South America',
      })})
    })
    await page.route('**/api/benchmarks', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ benchmark_id: 'test-bench-003' }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(completedState) })
      }
    })
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    await page.locator('.btn-start').click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}/06-light-completed.png`, fullPage: true })
    console.log('✓ 06-light-completed.png')
    await page.close()
  }

  await browser.close()
  console.log('\nAll screenshots captured in', OUT)
}

const providers = [
  {
    "id": "cloudflare",
    "name": "Cloudflare",
    "dns": ["1.1.1.1", "1.0.0.1"],
    "tags": ["global", "anycast", "privacidad"],
    "region": "global",
    "country": null,
    "goals": ["speed", "privacy"],
    "features": { "filtering": "no", "malware_protection": "no", "family": "no", "doh": "yes", "dot": "yes" },
    "notes_es": "DNS global rápido y muy usado; buena latencia en la mayoría de regiones."
  },
  {
    "id": "google",
    "name": "Google Public DNS",
    "dns": ["8.8.8.8", "8.8.4.4"],
    "tags": ["global", "anycast"],
    "region": "global",
    "country": null,
    "goals": ["speed"],
    "features": { "filtering": "no", "malware_protection": "no", "family": "no", "doh": "yes", "dot": "yes" },
    "notes_es": "Servicio DNS global con amplia infraestructura y alta disponibilidad."
  },
  {
    "id": "quad9",
    "name": "Quad9",
    "dns": ["9.9.9.9", "149.112.112.112"],
    "tags": ["global", "privacidad", "seguridad"],
    "region": "global",
    "country": null,
    "goals": ["security", "privacy", "speed"],
    "features": { "filtering": "yes", "malware_protection": "yes", "family": "no", "doh": "yes", "dot": "yes" },
    "notes_es": "Prioriza bloqueo de dominios maliciosos con buena presencia global."
  },
  {
    "id": "opendns", "name": "OpenDNS", "dns": ["208.67.222.222", "208.67.220.220"],
    "tags": ["global", "familiar"], "region": "global", "country": null,
    "goals": ["security", "family"],
    "features": { "filtering": "yes", "malware_protection": "yes", "family": "yes", "doh": "no", "dot": "no" },
    "notes_es": "Alternativa clásica con perfiles familiares y filtros de contenido."
  },
  {
    "id": "adguard", "name": "AdGuard DNS", "dns": ["94.140.14.14", "94.140.15.15"],
    "tags": ["privacidad", "filtrado"], "region": "global", "country": null,
    "goals": ["ad-blocking", "privacy", "security"],
    "features": { "filtering": "yes", "malware_protection": "yes", "family": "optional", "doh": "yes", "dot": "yes" },
    "notes_es": "Enfocado en bloqueo de publicidad y protección básica de malware."
  },
  {
    "id": "mullvad", "name": "Mullvad DNS", "dns": ["194.242.2.2", "194.242.2.3"],
    "tags": ["privacidad"], "region": "europe", "country": "se",
    "goals": ["privacy"],
    "features": { "filtering": "optional", "malware_protection": "optional", "family": "optional", "doh": "yes", "dot": "yes" },
    "notes_es": "Proveedor orientado a privacidad; útil para comparar latencia frente a grandes anycast."
  },
  {
    "id": "nicbr", "name": "NIC.br", "dns": ["200.160.0.8", "200.189.40.8"],
    "tags": ["latam"], "region": "south-america", "country": "br",
    "goals": ["speed"],
    "features": { "filtering": "no", "malware_protection": "no", "family": "no", "doh": "unknown", "dot": "unknown" },
    "notes_es": "Opción regional de Brasil para medir desempeño interregional en LATAM."
  },
  {
    "id": "isp-detectado", "name": "ISP (Detectado)", "dns": [],
    "tags": ["isp_detectado"], "region": null, "country": null,
    "goals": [],
    "features": { "filtering": "unknown", "malware_protection": "unknown", "family": "unknown", "doh": "unknown", "dot": "unknown" },
    "notes_es": "Representa los DNS detectados en tu sistema local en este momento."
  }
]

const runningState = {
  "id": "test-bench-001",
  "status": "running",
  "progress": { "current": 12, "total": 48, "current_resolver": "1.1.1.1", "last_sample_at": Date.now() - 3000, "avg_latency_ms": 24.5 },
  "started_at": new Date(Date.now() - 15000).toISOString(),
  "finished_at": null,
  "mode": "standard",
  "timeout_sec": 2,
  "runs": 30,
  "engine": "drill",
  "error": null,
  "run_storage_warning": null,
  "results": [
    { "resolver": "1.1.1.1", "provider_id": "cloudflare", "provider_name": "Cloudflare", "engine": "drill",
      "stats": { "avg_ms": 12.3, "median_ms": 11.8, "p95_ms": 18.2, "min_ms": 8.1, "max_ms": 22.4, "ok_count": 10, "timeout_count": 0, "success_rate": 1, "timeout_rate": 0, "success_count": 10, "failure_count": 0, "failure_rate": 0, "consistency_ratio": 0.92, "p95_minus_median_ms": 6.4, "score_latency": 12.3, "score_reliability": 1, "score_stability": 0.92, "score_total": 0.98, "normalized_latency": 0.95, "normalized_reliability": 1, "normalized_stability": 0.92 },
      "samples": [], "sample_count": 10, "is_unreliable": false },
    { "resolver": "8.8.8.8", "provider_id": "google", "provider_name": "Google Public DNS", "engine": "drill",
      "stats": { "avg_ms": 15.7, "median_ms": 14.2, "p95_ms": 24.1, "min_ms": 10.2, "max_ms": 28.6, "ok_count": 8, "timeout_count": 0, "success_rate": 1, "timeout_rate": 0, "success_count": 8, "failure_count": 0, "failure_rate": 0, "consistency_ratio": 0.85, "p95_minus_median_ms": 9.9, "score_latency": 15.7, "score_reliability": 1, "score_stability": 0.85, "score_total": 0.91, "normalized_latency": 0.82, "normalized_reliability": 1, "normalized_stability": 0.85 },
      "samples": [], "sample_count": 8, "is_unreliable": false },
    { "resolver": "9.9.9.9", "provider_id": "quad9", "provider_name": "Quad9", "engine": "drill",
      "stats": { "avg_ms": 28.4, "median_ms": 26.1, "p95_ms": 42.3, "min_ms": 18.5, "max_ms": 48.2, "ok_count": 6, "timeout_count": 0, "success_rate": 1, "timeout_rate": 0, "success_count": 6, "failure_count": 0, "failure_rate": 0, "consistency_ratio": 0.78, "p95_minus_median_ms": 16.2, "score_latency": 28.4, "score_reliability": 1, "score_stability": 0.78, "score_total": 0.85, "normalized_latency": 0.65, "normalized_reliability": 1, "normalized_stability": 0.78 },
      "samples": [], "sample_count": 6, "is_unreliable": false },
    { "resolver": "208.67.222.222", "provider_id": "opendns", "provider_name": "OpenDNS", "engine": "drill",
      "stats": { "avg_ms": 35.2, "median_ms": 32.8, "p95_ms": 52.1, "min_ms": 22.4, "max_ms": 58.3, "ok_count": 5, "timeout_count": 1, "success_rate": 0.83, "timeout_rate": 0.17, "success_count": 5, "failure_count": 1, "failure_rate": 0.17, "consistency_ratio": 0.72, "p95_minus_median_ms": 19.3, "score_latency": 35.2, "score_reliability": 0.83, "score_stability": 0.72, "score_total": 0.76, "normalized_latency": 0.48, "normalized_reliability": 0.83, "normalized_stability": 0.72 },
      "samples": [], "sample_count": 6, "is_unreliable": false }
  ],
  "recommended_resolver": "1.1.1.1",
  "recommendation_warning": null
}

const completedState = {
  "id": "test-bench-002",
  "status": "done",
  "progress": { "current": 48, "total": 48, "current_resolver": null, "last_sample_at": Date.now() - 10000, "avg_latency_ms": 22.8 },
  "started_at": new Date(Date.now() - 120000).toISOString(),
  "finished_at": new Date(Date.now() - 5000).toISOString(),
  "mode": "standard",
  "timeout_sec": 2,
  "runs": 30,
  "engine": "drill",
  "error": null,
  "run_storage_warning": null,
  "results": [
    { "resolver": "1.1.1.1", "provider_id": "cloudflare", "provider_name": "Cloudflare", "engine": "drill",
      "stats": { "avg_ms": 11.2, "median_ms": 10.5, "p95_ms": 16.8, "min_ms": 7.2, "max_ms": 20.1, "ok_count": 30, "timeout_count": 0, "success_rate": 1, "timeout_rate": 0, "success_count": 30, "failure_count": 0, "failure_rate": 0, "consistency_ratio": 0.94, "p95_minus_median_ms": 6.3, "score_latency": 11.2, "score_reliability": 1, "score_stability": 0.94, "score_total": 0.99, "normalized_latency": 0.98, "normalized_reliability": 1, "normalized_stability": 0.94 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "1.0.0.1", "provider_id": "cloudflare", "provider_name": "Cloudflare", "engine": "drill",
      "stats": { "avg_ms": 12.8, "median_ms": 11.9, "p95_ms": 19.2, "min_ms": 8.4, "max_ms": 23.5, "ok_count": 30, "timeout_count": 0, "success_rate": 1, "timeout_rate": 0, "success_count": 30, "failure_count": 0, "failure_rate": 0, "consistency_ratio": 0.92, "p95_minus_median_ms": 7.3, "score_latency": 12.8, "score_reliability": 1, "score_stability": 0.92, "score_total": 0.97, "normalized_latency": 0.95, "normalized_reliability": 1, "normalized_stability": 0.92 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "8.8.8.8", "provider_id": "google", "provider_name": "Google Public DNS", "engine": "drill",
      "stats": { "avg_ms": 14.5, "median_ms": 13.2, "p95_ms": 22.8, "min_ms": 9.1, "max_ms": 26.4, "ok_count": 30, "timeout_count": 0, "success_rate": 1, "timeout_rate": 0, "success_count": 30, "failure_count": 0, "failure_rate": 0, "consistency_ratio": 0.88, "p95_minus_median_ms": 9.6, "score_latency": 14.5, "score_reliability": 1, "score_stability": 0.88, "score_total": 0.94, "normalized_latency": 0.88, "normalized_reliability": 1, "normalized_stability": 0.88 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "8.8.4.4", "provider_id": "google", "provider_name": "Google Public DNS", "engine": "drill",
      "stats": { "avg_ms": 15.1, "median_ms": 14.0, "p95_ms": 23.5, "min_ms": 9.8, "max_ms": 27.2, "ok_count": 29, "timeout_count": 1, "success_rate": 0.97, "timeout_rate": 0.03, "success_count": 29, "failure_count": 1, "failure_rate": 0.03, "consistency_ratio": 0.87, "p95_minus_median_ms": 9.5, "score_latency": 15.1, "score_reliability": 0.97, "score_stability": 0.87, "score_total": 0.92, "normalized_latency": 0.85, "normalized_reliability": 0.97, "normalized_stability": 0.87 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "9.9.9.9", "provider_id": "quad9", "provider_name": "Quad9", "engine": "drill",
      "stats": { "avg_ms": 26.8, "median_ms": 24.5, "p95_ms": 40.2, "min_ms": 16.8, "max_ms": 45.1, "ok_count": 29, "timeout_count": 1, "success_rate": 0.97, "timeout_rate": 0.03, "success_count": 29, "failure_count": 1, "failure_rate": 0.03, "consistency_ratio": 0.81, "p95_minus_median_ms": 15.7, "score_latency": 26.8, "score_reliability": 0.97, "score_stability": 0.81, "score_total": 0.87, "normalized_latency": 0.68, "normalized_reliability": 0.97, "normalized_stability": 0.81 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "94.140.14.14", "provider_id": "adguard", "provider_name": "AdGuard DNS", "engine": "drill",
      "stats": { "avg_ms": 31.5, "median_ms": 29.2, "p95_ms": 48.7, "min_ms": 20.4, "max_ms": 52.3, "ok_count": 28, "timeout_count": 2, "success_rate": 0.93, "timeout_rate": 0.07, "success_count": 28, "failure_count": 2, "failure_rate": 0.07, "consistency_ratio": 0.76, "p95_minus_median_ms": 19.5, "score_latency": 31.5, "score_reliability": 0.93, "score_stability": 0.76, "score_total": 0.82, "normalized_latency": 0.55, "normalized_reliability": 0.93, "normalized_stability": 0.76 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "208.67.222.222", "provider_id": "opendns", "provider_name": "OpenDNS", "engine": "drill",
      "stats": { "avg_ms": 34.2, "median_ms": 31.5, "p95_ms": 50.8, "min_ms": 21.2, "max_ms": 56.7, "ok_count": 27, "timeout_count": 3, "success_rate": 0.9, "timeout_rate": 0.1, "success_count": 27, "failure_count": 3, "failure_rate": 0.1, "consistency_ratio": 0.74, "p95_minus_median_ms": 19.3, "score_latency": 34.2, "score_reliability": 0.9, "score_stability": 0.74, "score_total": 0.79, "normalized_latency": 0.48, "normalized_reliability": 0.9, "normalized_stability": 0.74 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "194.242.2.2", "provider_id": "mullvad", "provider_name": "Mullvad DNS", "engine": "drill",
      "stats": { "avg_ms": 58.3, "median_ms": 55.1, "p95_ms": 82.4, "min_ms": 38.2, "max_ms": 91.5, "ok_count": 30, "timeout_count": 0, "success_rate": 1, "timeout_rate": 0, "success_count": 30, "failure_count": 0, "failure_rate": 0, "consistency_ratio": 0.82, "p95_minus_median_ms": 27.3, "score_latency": 58.3, "score_reliability": 1, "score_stability": 0.82, "score_total": 0.78, "normalized_latency": 0.18, "normalized_reliability": 1, "normalized_stability": 0.82 },
      "samples": [], "sample_count": 30, "is_unreliable": false },
    { "resolver": "200.160.0.8", "provider_id": "nicbr", "provider_name": "NIC.br", "engine": "drill",
      "stats": { "avg_ms": 72.1, "median_ms": 68.4, "p95_ms": 98.2, "min_ms": 45.6, "max_ms": 105.3, "ok_count": 28, "timeout_count": 2, "success_rate": 0.93, "timeout_rate": 0.07, "success_count": 28, "failure_count": 2, "failure_rate": 0.07, "consistency_ratio": 0.78, "p95_minus_median_ms": 29.8, "score_latency": 72.1, "score_reliability": 0.93, "score_stability": 0.78, "score_total": 0.71, "normalized_latency": 0.05, "normalized_reliability": 0.93, "normalized_stability": 0.78 },
      "samples": [], "sample_count": 30, "is_unreliable": false }
  ],
  "recommended_resolver": "1.1.1.1",
  "recommendation_warning": null
}

main().catch(err => { console.error(err); process.exit(1) })
