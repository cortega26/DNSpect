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

### Contrato de comparación de runs (manifest inmutable)

Una comparación numérica entre dos ejecuciones solo es válida cuando ambas
comparten exactamente el mismo manifest inmutable. Este contrato lo declara de
forma explícita para no presentar deltas engañosos entre runs incomparables.

1. **Versiones de semántica**: el manifest comienza en
   `run_manifest_version = 1` y contiene versiones independientes
   `response_semantics_version = "dns-response-v1"` (semántica de RCODE y
   muestras no utilizables del Plan 001) y
   `scoring_semantics_version = "score-v1"`. Se incrementa/cambia el valor
   correspondiente cuando cambia la clasificación de respuestas o el cálculo
   de ranking; una etiqueta de perfil por sí sola no congela esas semánticas.
2. **Campos del manifest**: todo run nuevo persiste un manifest con
   `run_manifest_version`, ambas versiones de semántica, el `scoring_profile`
   canónico, el `target_snapshot` completo, `protocol`, `mode`, `runs`
   efectivo, `timeout_sec`, `normal_query_schedule_version`,
   `normal_query_plan_sha256`, `normal_query_count`,
   `blocking_query_plan_sha256`, `blocking_query_count`,
   `diagnostic_policy_version` y `provider_catalog_sha256`.
3. **Reglas de derivación**:
   - `normal_query_schedule_version = "round-robin-v1"` identifica el
     algoritmo de schedule actual. El schedule normal efectivo se construye
     exactamente como `[config.queries[i % len(config.queries)] for i in
     range(config.runs)]`; se hashea como
     `sha256(json.dumps(schedule, ensure_ascii=False,
     separators=(",", ":")).encode("utf-8"))` y
     `normal_query_count = len(schedule)` (es decir, `runs`). La lista de
     dominios de bloqueo activos se hashea con la misma regla JSON y
     `blocking_query_count` es su longitud. Así el manifest congela la
     secuencia cíclica real de consultas, no solo la lista fuente.
   - `diagnostic_policy_version` identifica el algoritmo actual de NXDOMAIN
     aleatorio (NXDOMAIN hijacking) pero nunca guarda su etiqueta aleatoria;
     una etiqueta aleatoria no es clave de comparación. Si el algoritmo cambia,
     se incrementa esta versión.
   - El digest del catálogo se construye desde el `provider_index` estático
     (mapeo por IP de resolver normalizada) y se hashea
     `json.dumps(provider_index, ensure_ascii=False, sort_keys=True,
     separators=(",", ":"))` codificado en UTF-8. Los registros de provider son
     JSON de loader: se preserva el orden de los arrays dentro de un registro;
     cualquier cambio de datos o de orden de lista hace los runs
     conservadoramente incomparables. Nunca se hashean timestamps, identidades
     de objetos ni una recarga posterior del catálogo.
4. **Comparabilidad**: dos runs `done` son comparables solo cuando **todos**
   los campos del punto 2 son exactamente iguales, incluyendo el snapshot de
   destino completo y ambas versiones de semántica. Una diferencia en el
   conjunto de destinos es `target_snapshot_mismatch`, nunca una unión
   parcialmente comparable.
5. **Ruta**: `GET /api/benchmarks/compare?baseline_id=<uuid>&candidate_id=<uuid>`
   se registra antes de la ruta dinámica `GET /api/benchmarks/{benchmark_id}`.
   Ambos parámetros son opcionales (`str | None`) y se exige que cada uno sea
   exactamente un UUIDv4 `.hex` en minúsculas de 32 caracteres antes de llamar
   a `manager.get()`. IDs faltantes, malformados, en mayúsculas, con guiones o
   no-v4 devuelven HTTP 404, incluso si existiera un benchmark legacy en
   memoria con ID no-UUID; el endpoint solo acepta IDs de runs persistidos
   generados. Solo `status == "done"` es comparable: `queued`, `running` y
   `failed` devuelven 409; los runs fallidos no son un modo terminal de
   comparación oculto. Dos runs `done` legibles siempre devuelven HTTP 200 con
   un `RunComparisonResponse` tipado.
6. **Tipos de respuesta**:
   - `RunComparisonResponse`: `baseline_id: str`, `candidate_id: str`,
     `baseline_manifest: RunManifest | null`, `candidate_manifest:
     RunManifest | null`, `comparable: bool`, `reason_codes:
     list[ComparisonReasonCode]`, `rows: list[RunComparisonRow]`,
     `missing_baseline_results: list[str]` y `missing_candidate_results:
     list[str]`.
   - `RunComparisonRow`: `resolver: str`, `baseline: RunComparisonMetrics`,
     `candidate: RunComparisonMetrics`, `baseline_rank: int`,
     `candidate_rank: int` y `deltas: RunComparisonDeltas`.
   - Cada objeto de métricas tiene floats nullable `median_ms`, `p95_ms`,
     `success_rate`, `failure_rate`, `blocking_efficacy` y `score_total`, y no
     tiene campo de rank; el objeto de deltas correspondiente tiene floats
     nullable para esas seis métricas y un `rank: int` con signo.
   - Los arrays de resultados faltantes contienen solo IPs de resolver
     canónicas en orden de respuesta (sort lexicográfico).
   - Si un manifest está ausente o es inválido, su campo queda `null`, su
     código `manifest_missing`/`manifest_invalid` exacto permanece presente y
     la UI muestra solo el ID seleccionado más una explicación traducida de
     manifest no disponible — nunca campos o deltas.
   - Si `comparable` es falso, los tres arrays quedan vacíos. Si es verdadero,
     las filas contienen solo la IP `resolver` normalizada presente en ambos
     arrays de resultados; una fila de resultado ausente se lista en
     exactamente un array de faltantes y no tiene fila ni delta.

Códigos de no comparabilidad exactos (orden estable):

`manifest_missing`, `manifest_invalid`, `manifest_version_mismatch`,
`response_semantics_mismatch`, `scoring_semantics_mismatch`,
`scoring_profile_mismatch`, `target_snapshot_mismatch`, `protocol_mismatch`,
`query_plan_mismatch`, `mode_mismatch`, `runs_mismatch`, `timeout_mismatch`,
`diagnostic_policy_mismatch`, `provider_catalog_mismatch`.

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
| `/api/benchmarks/compare` | GET | Comparación determinista de dos runs con manifest inmutable idéntico |
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
