# Arquitectura

## Resumen

`dns-speed-lab` usa arquitectura local híbrida:

- **Frontend**: React + Vite + TypeScript
- **Backend**: FastAPI

Motivo: el navegador no puede realizar consultas DNS UDP directas de forma nativa.

## Backend

Ruta: `backend/app/`

- `main.py`: endpoints API, exportaciones y servido de frontend estático en modo empaquetado.
- `models.py`: validación estricta de entrada (`runs`, `timeout`, resolvers IP, hostnames).
- `runner.py`: ejecución de benchmarks en background, clasificación de fallos, persistencia.
- `stats.py`: parser de `drill` y cálculo de métricas.
- `detect_dns.py`: detección DNS del sistema (Linux/Windows).
- `providers.py`: carga de dataset de proveedores y queries.
- `cli.py`: arranque de servidor para binario empaquetado.

### Motores DNS

- Linux: `drill` si está disponible.
- Fallback/Windows: `dnspython`.

### Contrato de BenchmarkStatus

`GET /api/benchmarks/{id}` retorna:

- `status`: `running | done | error`
- `progress`: `current`, `total`, `current_resolver`
- `results` (solo cuando `done`)

Por defecto, `results` retorna **sin muestras** (`samples: []` + `sample_count`).

Para incluir muestras:

- `GET /api/benchmarks/{id}?include_samples=1`
- `GET /api/benchmarks/{id}/export.json?include_samples=1`

### Ranking

Orden aplicado:

1. `median_ms` asc
2. `p95_ms` asc
3. `timeout_count` asc

Rationale: prioriza latencia típica, luego consistencia en cola alta, luego confiabilidad por timeouts.

### Persistencia

- Siempre guarda metadatos del run en `backend/data/runs/<id>.json`.
- Puede guardar muestras completas si `DNS_SPEED_LAB_PERSIST_SAMPLES=1` en `backend/data/runs/<id>.samples.json`.

## Frontend

Ruta: `frontend/src/`

- Dashboard de configuración y progreso
- Ranking con filtros (texto, confiabilidad, NA)
- Recomendación primaria/secundaria aplicable en 1 click
- Gráficos con límite Top-N para legibilidad
- Modal detalle por resolver (muestras bajo demanda)

## Packaging (Release)

Estrategia implementada: **Option B**

1. `frontend` se compila a estáticos (`frontend/dist`).
2. `FastAPI` sirve esos estáticos en `/`.
3. PyInstaller genera binario único de backend + estáticos + `data/`.

Archivos relevantes:

- `scripts/package_backend.py`
- `.github/workflows/release.yml`

## Seguridad

- Resolver input: solo IP literal.
- Queries: hostname validado.
- Límites de workload: `runs <= 300`, `timeout <= 10`.
- Subprocess seguro sin `shell=True`.
- Sin telemetría.
