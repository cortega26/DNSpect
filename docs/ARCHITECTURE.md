# Arquitectura

## Resumen

`DNSpect` usa arquitectura local híbrida:

- **Frontend**: React + Vite + TypeScript
- **Backend**: FastAPI

Motivo: el navegador no puede realizar consultas DNS UDP directas de forma nativa.

## Backend

Ruta: `backend/app/`

- `main.py`: endpoints de API, exportaciones y servido del frontend estático en modo empaquetado.
- `models.py`: validación estricta de entrada (`runs`, `timeout`, resolvers IP, hostnames).
- `runner.py`: ejecución de benchmarks en segundo plano, clasificación de fallos y persistencia.
- `stats.py`: parser de `drill` y cálculo de métricas.
- `detect_dns.py`: detección DNS del sistema (Linux/Windows).
- `providers.py`: carga del conjunto de datos de proveedores y consultas.
- `cli.py`: arranque de servidor para binario empaquetado.

### Motores DNS

- Linux: `drill` si está disponible.
- Fallback y Windows: `dnspython`.

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

Justificación: prioriza la latencia típica, luego la consistencia en la cola alta y, por último, la confiabilidad según timeouts.

### Persistencia

- Siempre guarda metadatos del run en `backend/data/runs/<id>.json`.
- Puede guardar muestras completas si `DNS_SPEED_LAB_PERSIST_SAMPLES=1` en `backend/data/runs/<id>.samples.json`.

## Frontend

Ruta: `frontend/src/`

- Dashboard de configuración y progreso
- Ranking con filtros (texto, confiabilidad, NA)
- Recomendación primaria/secundaria aplicable en 1 clic
- Gráficos con límite Top-N para legibilidad
- Modal detalle por resolver (muestras bajo demanda)

## Packaging (Release)

Estrategia implementada: **Opción B**

1. `frontend` se compila a estáticos (`frontend/dist`).
2. `FastAPI` sirve esos estáticos en `/`.
3. PyInstaller genera binario único de backend + estáticos + `data/`.

Archivos relevantes:

- `scripts/package_backend.py`
- `.github/workflows/release.yml`

## Seguridad

- Entrada de resolver: solo IP literal.
- Consultas: hostname validado.
- Límites de workload: `runs <= 300`, `timeout <= 10`.
- Subproceso seguro sin `shell=True`.
- Sin telemetría.
