# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend
```bash
# Install (requires Python >=3.13)
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -c constraints.txt -e .[dev]

# Run dev server
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Lint & format check
cd backend && source .venv/bin/activate && ruff check . && ruff format --check .

# Type check
cd backend && source .venv/bin/activate && mypy

# Security scan
cd backend && source .venv/bin/activate && bandit -q -c pyproject.toml -r app

# Run all tests (quiet mode)
cd backend && source .venv/bin/activate && pytest -q

# Run a single test file
cd backend && source .venv/bin/activate && pytest tests/test_stats.py -q

# Run a single test
cd backend && source .venv/bin/activate && pytest tests/test_stats.py::test_some_function -q
```

### Frontend
```bash
# Install (requires Node 24)
cd frontend && npm ci

# Dev server (default :5173)
cd frontend && npm run dev

# Lint, typecheck, build
cd frontend && npm run lint && npm run typecheck && npm run build

# Run tests (vitest)
cd frontend && npm test
```

### Full stack dev (Linux/macOS)
```bash
bash scripts/dev.sh
```

### Make targets
- `make backend-check` — lint, format check, mypy, bandit, pytest
- `make backend-semgrep` — semgrep SAST scan
- `make frontend-check` — lint, typecheck, build
- `make dev` — run both servers
- `make smoke` — smoke test script
- `make flatpak-validate` — flatpak build + lint

## Project architecture

### Stack
- **Backend**: FastAPI (Python 3.13+) with uvicorn, Pydantic v2, dnspython
- **Frontend**: React 18 + Vite + TypeScript, Recharts (lazy-loaded, ~382 kB)

### Backend layout (`backend/app/`)
- `main.py` — FastAPI app, API endpoints (`/api/benchmarks`, `/api/providers`, `/api/dns/system`, `/api/geoip`, `/api/probe`), CSV/JSON export, SPA fallback
- `models.py` — Pydantic models for `BenchmarkRequest`, `ProbeRequest` with strict IP/hostname validation
- `runner.py` — `BenchmarkManager` (thread-safe), `BenchmarkState`, `ThreadPoolExecutor` for async benchmark execution, drill/dnspython query runners, failure classification
- `stats.py` — `compute_stats()`, `apply_normalized_scoring()`, `select_recommended_resolver()`, percentile calculation, goal-aware scoring weights
- `providers.py` — Loads resolver dataset from `data/dns_providers.es.json` and default queries from `data/queries.txt`
- `detect_dns.py` — Cross-platform system DNS detection (resolvectl, scutil, networksetup, ipconfig, netsh)
- `geoip.py` — Optional MaxMind GeoIP database lookup, country-to-region mapping
- `cli.py` — Entry point for the PyInstaller-packaged binary (GTK/WebKit native GUI, browser, or headless mode)
- `packaged_main.py` — PyInstaller entry point stub (imports and runs `app.cli:main`)

### Frontend layout (`frontend/src/`)
- `App.tsx` — Main app component: state, polling, orchestration, i18n, theme
- `components/DashboardControls.tsx` — Mode/goal/region/timeout resolver selection
- `components/LiveRankingPanel.tsx` — Animated live ranking during benchmark
- `components/RecommendedResolverPanel.tsx` — Post-benchmark recommendation card
- `components/ResolverRankingPanel.tsx` — Full ranking table with filters
- `components/ChartsPanel.tsx` — Lazy-loaded Recharts (median/p95/reliability)
- `components/GuidedApplyModal.tsx` — Platform-specific DNS apply guide modal
- `components/ResolverDetailModal.tsx` — Per-resolver detail with time series/histogram
- `lib/types.ts` — TypeScript types for API responses, providers, benchmark state
- `lib/api.ts` — API client functions
- `lib/i18n-translations.ts` — ES/EN/PT translations (ES is source of truth)
- `lib/utils.ts` — Provider filtering (by goal, region), formatters, reliability score
- `lib/reporting.ts` — Last-run persistence, CSV builder, share summary
- `lib/runtime.ts` — Polling heuristics, stall detection, small-improvement detection
- `lib/probe.ts` — Probe response parsing, comparison logic
- `lib/applyGuide.ts` — DNS clipboard text and guided set builder

### Data flow
1. User selects resolvers/goal/mode/timeout in UI → `POST /api/benchmarks`
2. `BenchmarkManager` validates via Pydantic, queues the job, returns `benchmark_id`
3. `ThreadPoolExecutor` runs queries per resolver (drill or dnspython)
4. Frontend polls `GET /api/benchmarks/{id}` for progress and partial results
5. On completion, backend computes normalized scoring (goal-weighted), ranking, recommendation
6. Results are rendered: recommended resolver panel, full ranking, charts, export options

### Key design constraints
- **Determinism**: Same inputs → identical ranking (no randomness in scoring)
- **Goal system**: Goals filter available providers and adjust scoring weights (latency/reliability/stability)
- **Region filtering**: Optional GeoIP lookup → providers filtered by continent region
- **Translations**: ES is source of truth (263+ keys), tests enforce completeness for EN and PT
- **Scoring**: Goal-aware weights normalize latency/reliability/stability into a composite `score_total`
- **Reliability guardrail**: Resolvers with `failure_rate > 5%` are flagged `is_unreliable` and avoided for recommendations
- **Flatpak distribution**: Packaged as a Flatpak for Flathub — SEO/social meta tags are irrelevant
- **Benchmark capacity**: Configurable max concurrent + queued jobs via env vars (`DNS_SPEED_LAB_MAX_CONCURRENT_JOBS`, `DNS_SPEED_LAB_MAX_QUEUED_JOBS`)

### API endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health check + version |
| `/api/providers` | GET | Resolver provider dataset |
| `/api/dns/system` | GET | System DNS detection |
| `/api/geoip` | GET | GeoIP lookup (optional) |
| `/api/probe` | POST | Quick probe (small sample) |
| `/api/benchmarks` | POST | Start benchmark |
| `/api/benchmarks/{id}` | GET | Poll status/results |
| `/api/benchmarks/{id}/export.csv` | GET | CSV export |
| `/api/benchmarks/{id}/export.json` | GET | JSON export |

### Environment variables
- `DNS_SPEED_LAB_MAX_CONCURRENT_JOBS` (default: 2) — thread pool size
- `DNS_SPEED_LAB_MAX_QUEUED_JOBS` (default: 5) — queue depth
- `DNS_SPEED_LAB_TERMINAL_TTL_SEC` (default: 3600) — completed run TTL
- `DNS_SPEED_LAB_MAX_RETAINED_STATES` (default: 256) — max in-memory states
- `DNS_SPEED_LAB_PERSIST_SAMPLES` — set to `1` to persist full samples
- `DNS_SPEED_LAB_DATA_DIR` — override data directory
- `DNS_SPEED_LAB_RUNS_DIR` — override runs persistence directory
- `DNS_SPEED_LAB_GEOIP_DB` — path to GeoLite2-City.mmdb
- `DNS_SPEED_LAB_FRONTEND_DIR` — override frontend dist directory
- `VITE_API_BASE` (frontend) — base URL for API calls
- `BACKEND_HOST`, `BACKEND_PORT`, `FRONTEND_HOST`, `FRONTEND_PORT` — dev server addresses
