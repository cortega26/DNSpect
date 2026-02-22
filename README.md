# DNSpect

Local DNS resolver benchmark with real query timing (not ICMP ping), guided UI, exports, and release-ready binaries.

[![CI](https://github.com/cortega26/DNSpect/actions/workflows/ci.yml/badge.svg)](https://github.com/cortega26/DNSpect/actions/workflows/ci.yml)
[![Release](https://github.com/cortega26/DNSpect/actions/workflows/release.yml/badge.svg)](https://github.com/cortega26/DNSpect/actions/workflows/release.yml)
[![License](https://github.com/cortega26/DNSpect/raw/main/.github/badges/license-mit.svg)](https://github.com/cortega26/DNSpect/blob/main/LICENSE)

## Why DNSpect

- Measures DNS resolution latency directly with `drill` (Linux when available) or `dnspython` fallback.
- Compares resolvers with median, p95, average, timeout rate, and consistency metrics.
- Runs locally: no analytics, no telemetry.
- Exports CSV and JSON summaries, plus optional JSON with samples (`include_samples=1`).

## Quickstart (Dev)

### Linux/macOS

```bash
bash scripts/dev.sh
```

Optional env vars:

- `BACKEND_HOST` (default `127.0.0.1`)
- `BACKEND_PORT` (default `8000`)
- `FRONTEND_HOST` (default `127.0.0.1`)
- `FRONTEND_PORT` (default `5173`)
- `PYTHON_BIN` (optional Python override)

### Windows (PowerShell)

```powershell
.\scripts\dev.ps1
```

## Releases

DNSpect release artifacts bundle the built frontend served by FastAPI and a packaged backend.

1. Download the latest asset from [GitHub Releases](https://github.com/cortega26/DNSpect/releases).
2. Run the binary (`dnspect-linux-x64`, `dnspect-macos-x64`, `dnspect-macos-arm64`, or `dnspect-windows-x64.exe`).
3. Open `http://127.0.0.1:8000`.

Release checksum/signature verification guide:

- [`docs/RELEASE_VERIFY.md`](docs/RELEASE_VERIFY.md)

Optional env vars:

- `DNS_SPEED_LAB_HOST` (default `127.0.0.1`)
- `DNS_SPEED_LAB_PORT` (default `8000`)
- `DNS_SPEED_LAB_OPEN_BROWSER` (`1` or `0`)

## Privacy

- Everything runs locally on your machine.
- DNSpect only sends DNS queries to selected resolvers.
- No telemetry/analytics collection.

## Troubleshooting

- Linux DNS tooling and runtime notes: [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
- Security reporting: [`SECURITY.md`](SECURITY.md)

## Contributing

- Contribution flow and standards: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Architecture overview: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Provider data details: [`docs/PROVIDERS.md`](docs/PROVIDERS.md)

## Smoke Test

### Linux/macOS

```bash
bash scripts/smoke_test.sh
```

### Windows (PowerShell)

```powershell
.\scripts\smoke_test.ps1
```
