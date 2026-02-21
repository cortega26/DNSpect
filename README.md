# dns-speed-lab

`dns-speed-lab` es una app local para comparar resolvers DNS con medición **real de resolución** (no ICMP ping), interfaz moderna en español, exportación de resultados y empaquetado para releases.

Versión actual: **0.2.0** (SemVer).

## Qué hace

- Benchmark DNS real por resolver usando:
  - `drill` (Linux, si está disponible)
  - `dnspython` (Windows y fallback)
- Métricas por resolver:
  - `avg_ms`, `median_ms`, `p95_ms`, `min_ms`, `max_ms`
  - `ok_count`, `timeout_count`, `success_rate`, `timeout_rate`
  - `consistency_ratio`, `p95_minus_median_ms`
- Clasificación de fallos por muestra:
  - `timeout | nxdomain | servfail | refused | noanswer | other`
- UI en español con:
  - Dashboard, ranking, filtros, recomendaciones, gráficos y detalle
- Exportación:
  - CSV resumen
  - JSON resumen o JSON con muestras (`include_samples=1`)
- Detección automática de DNS del sistema/ISP.

## Por qué “ping al DNS” es incorrecto

`ping` mide latencia ICMP hacia una IP, **no** cuánto tarda una resolución DNS. Un resolver puede responder ICMP rápido y resolver consultas lento (o al revés). `dns-speed-lab` mide tiempo real de consulta DNS.

## Privacidad

- No hay telemetría ni analytics.
- Todo corre localmente.
- Solo se realizan consultas DNS a los resolvers configurados.

## Requisitos

### Linux (Mint/Ubuntu)

```bash
sudo apt update
sudo apt install -y ldnsutils
```

### Windows 10/11

No requiere `drill`; usa `dnspython` por defecto.

## Quick Start (Dev)

### Linux/macOS

```bash
bash scripts/dev.sh
```

Variables opcionales:

- `BACKEND_HOST` (default `127.0.0.1`)
- `BACKEND_PORT` (default `8000`)
- `FRONTEND_HOST` (default `127.0.0.1`)
- `FRONTEND_PORT` (default `5173`)
- `PYTHON_BIN` (si necesitas forzar un Python específico)

### Windows (PowerShell)

```powershell
.\scripts\dev.ps1
```

## Smoke Tests

### Linux/macOS

```bash
bash scripts/smoke_test.sh
```

### Windows (PowerShell)

```powershell
.\scripts\smoke_test.ps1
```

## API principal

- `GET /api/health`
- `GET /api/providers`
- `GET /api/dns/system`
- `POST /api/benchmarks`
- `GET /api/benchmarks/{id}` (por defecto sin muestras)
- `GET /api/benchmarks/{id}?include_samples=1`
- `GET /api/benchmarks/{id}/export.csv`
- `GET /api/benchmarks/{id}/export.json`
- `GET /api/benchmarks/{id}/export.json?include_samples=1`

## Releases (binario descargable)

Estrategia: **Option B**

- Frontend compilado (`frontend/dist`) servido por backend FastAPI
- Backend empaquetado con PyInstaller

### Ejecutar binario

1. Descarga el artefacto de GitHub Releases.
2. Ejecuta el binario (`dns-speed-lab-linux` o `dns-speed-lab-windows.exe`).
3. Abre `http://127.0.0.1:8000`.

Variables opcionales:

- `DNS_SPEED_LAB_HOST` (default `127.0.0.1`)
- `DNS_SPEED_LAB_PORT` (default `8000`)
- `DNS_SPEED_LAB_OPEN_BROWSER` (`1`/`0`)

## Calidad y CI

- Backend: `ruff`, `mypy`, `pytest`
- Frontend: `eslint`, `typecheck`, `build`
- CI en `.github/workflows/ci.yml`
- Release automation por tag `vX.Y.Z` en `.github/workflows/release.yml`

## Versionado

SemVer. Mantener alineados:

- `backend/app/__init__.py`
- `backend/pyproject.toml`
- `frontend/package.json`
- `CHANGELOG.md`

## Documentación adicional

- `docs/ARCHITECTURE.md`
- `docs/PROVIDERS.md`
- `docs/TROUBLESHOOTING.md`
