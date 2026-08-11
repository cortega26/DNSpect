# Arquitectura

## Resumen

`DNSpect` usa arquitectura local híbrida:

- **Frontend**: React + Vite + TypeScript
- **Backend**: FastAPI

Motivo: el navegador no puede realizar consultas DNS UDP directas de forma nativa.

## Backend

Ruta: `backend/app/`

- `main.py`: endpoints de API, exportaciones y servido del frontend estático en modo empaquetado.
- `models.py`: validación estricta de entrada (IP literales, hostnames), modelos `BenchmarkRequest`, `BenchmarkGoal`, `ProbeRequest`, `BenchmarkMode`.
- `runner.py`: `BenchmarkManager` (thread-safe), ejecución de benchmarks en segundo plano con `ThreadPoolExecutor`, clasificación de fallos, persistencia opcional de runs.
- `stats.py`: parser de `drill`, cálculo de métricas (`compute_stats`), scoring goal-aware (`apply_normalized_scoring`), selección de resolver recomendado (`select_recommended_resolver`), percentiles.
- `detect_dns.py`: detección DNS del sistema (resolvectl, scutil, networksetup, ipconfig, netsh).
- `providers.py`: carga del dataset de proveedores (`dns_providers.es.json`) y consultas por defecto (`queries.txt`).
- `geoip.py`: lookup opcional de GeoIP (MaxMind GeoLite2), mapeo país → región.
- `cli.py`: arranque del servidor para binario empaquetado (soporta native GTK/WebKit, browser, headless).

### Motores DNS

- Linux: `drill` si está disponible.
- Fallback y Windows: `dnspython`.

### Scoring y Ranking

El scoring usa pesos ajustables por perfil de puntuación (speed, security, privacy, ad-blocking, family). Las cuatro dimensiones son latencia, confiabilidad, estabilidad y bloqueo (`GOAL_WEIGHTS` en `backend/app/stats.py`):

| Perfil       | Latency | Reliability | Stability | Blocking |
|--------------|---------|-------------|-----------|----------|
| speed        | 0.55    | 0.25        | 0.10      | 0.10     |
| security     | 0.30    | 0.40        | 0.10      | 0.20     |
| privacy      | 0.35    | 0.35        | 0.15      | 0.15     |
| ad-blocking  | 0.25    | 0.40        | 0.10      | 0.25     |
| family       | 0.25    | 0.40        | 0.10      | 0.25     |

El perfil de puntuación controla la política de ranking y es independiente de la selección de resolvers; el snapshot de destino (`target_snapshot`) registra de forma inmutable qué conjunto exacto se midió (ver `docs/PROFILE_MODEL.md`).

El ranking se ordena por:

1. `score_total` asc (compuesto normalizado)
2. `avg_ms` asc
3. `score_stability` asc
4. `resolver` (tie-break lexicográfico)

Un resolver con `failure_rate > 5%` (o sin tasa calculable) se marca `is_unreliable` y se evita para recomendaciones. La recomendación elige el primer resolver confiable con estadísticas utilizables según el ranking; si todos son no confiables se devuelve el primero utilizable junto con una advertencia, y sin resultados utilizables no hay recomendación (`RECOMMENDATION_WARNING_ALL_UNRELIABLE` / `RECOMMENDATION_WARNING_NO_USABLE_RESULTS`).

### Contrato de BenchmarkStatus

`GET /api/benchmarks/{id}` retorna:

- `status`: `queued | running | done | failed | cancelled`
- `progress`: `current`, `total`, `current_resolver`, `last_sample_at`, `avg_latency_ms`
- `results`: solo cuando `done`, sin muestras por defecto (`samples: []` + `sample_count`).
- `recommended_resolver`: el primer resolver confiable según el ranking; con advertencia si todos son no confiables o no hay resultados utilizables.

Para incluir muestras:

- `GET /api/benchmarks/{id}?include_samples=1`
- `GET /api/benchmarks/{id}/export.json?include_samples=1`

### API endpoints

| Endpoint | Método | Propósito |
|---|---|---|
| `/api/health` | GET | Health check + versión |
| `/api/providers` | GET | Dataset de proveedores |
| `/api/dns/system` | GET | Detección de DNS del sistema |
| `/api/geoip` | GET | GeoIP lookup opcional |
| `/api/probe` | POST | Probe rápida (sample pequeño) |
| `/api/benchmarks` | POST | Iniciar benchmark |
| `/api/benchmarks/history` | GET | Historial de runs persistidos |
| `/api/benchmarks/{id}` | GET | Poll de estado/resultados |
| `/api/benchmarks/{id}/export.csv` | GET | Exportación CSV |
| `/api/benchmarks/{id}/export.json` | GET | Exportación JSON |

### Persistencia

- Siempre guarda metadatos del run en `<data_dir>/runs/<id>.json`.
- Puede guardar muestras completas si `DNS_SPEED_LAB_PERSIST_SAMPLES=1`.
- Estados terminales se limpian después de `terminal_ttl_sec` (default 3600s).
- Número máximo de estados retenidos: `max_retained_states` (default 256).
- Policies de cola: `max_concurrent_jobs` (default 2), `max_queued_jobs` (default 5).
- Path de datos: configurable via `DNS_SPEED_LAB_DATA_DIR`; por defecto `platformdirs` (`user_data_path("dnspect", "DNSpect") / "runs"`).

## Frontend

Ruta: `frontend/src/`

- `App.tsx`: orquestación principal, estado, polling, i18n, tema.
- `DashboardControls.tsx`: selección de resolvers, modo, perfil de puntuación, timeout y alcance de región.
- `LiveRankingPanel.tsx`: ranking animado durante benchmark.
- `RecommendedResolverPanel.tsx`: recomendación post-benchmark.
- `ResolverRankingPanel.tsx`: tabla completa con filtros.
- `ChartsPanel.tsx`: gráficos lazy-loaded (Recharts: mediana, p95, confiabilidad).
- `GuidedApplyModal.tsx`: guía para aplicar DNS.
- `ResolverDetailModal.tsx`: detalle por resolver con serie temporal/histograma.

La detección automática de alcance de región hace un único request público a `https://api.ipify.org?format=json` (IP solamente, timeout de 5 s, sin caché ni reintentos) y una consulta local a `/api/geoip`; solo se consume la región normalizada del backend y el resultado se descarta si el usuario ya eligió un alcance manual (política aprobada en `docs/REGION_TARGETING.md`).

## Packaging (Release)

Estrategia:

1. `frontend` se compila a estáticos (`frontend/dist`).
2. `FastAPI` sirve esos estáticos en `/`.
3. PyInstaller genera binario único de backend + estáticos + `data/`.

Archivos relevantes:

- `scripts/package_backend.py`
- `.github/workflows/release.yml`

## Seguridad

- Entrada de resolver: solo IP literal (IPv4/IPv6 validado).
- Consultas: hostname validado con regex estricto.
- Límites de workload: `runs <= 300`, `timeout <= 10s` (benchmark), `timeout <= 5s` (probe).
- Subprocesos seguros sin `shell=True`.
- Sin telemetría.
- Estados de benchmark bounded por cola + TTL.
