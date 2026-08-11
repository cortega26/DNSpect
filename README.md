# DNSpect
Deterministic, local-first DNS resolver benchmarking with FastAPI + React.

*Part of the [Tooltician ecosystem](https://tooltician.com) — local-first DNS resolver benchmarking.*

[![Part of Tooltician](https://img.shields.io/badge/Part_of-Tooltician.com-6C47FF?v=2)](https://tooltician.com)
[![CI](https://github.com/cortega26/DNSpect/actions/workflows/ci.yml/badge.svg)](https://github.com/cortega26/DNSpect/actions/workflows/ci.yml)
[![Release](https://github.com/cortega26/DNSpect/actions/workflows/release.yml/badge.svg)](https://github.com/cortega26/DNSpect/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/release/cortega26/DNSpect?display_name=tag)](https://github.com/cortega26/DNSpect/releases)
[![License](https://img.shields.io/github/license/cortega26/DNSpect)](LICENSE)
[![Python >=3.13](https://img.shields.io/badge/python-%3E%3D3.13-3776AB?logo=python&logoColor=white)](backend/pyproject.toml)
[![Node 24.x](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)](.github/workflows/ci.yml)
[![Security: Bandit](https://img.shields.io/badge/security-bandit%20(CI)-f59e0b)](.github/workflows/ci.yml)
[![Security: Semgrep](https://img.shields.io/badge/security-semgrep%20(CI)-14b8a6)](.github/workflows/ci.yml)
[![Code Quality: Ruff + mypy + ESLint + tsc](https://img.shields.io/badge/code%20quality-ruff%20%2B%20mypy%20%2B%20eslint%20%2B%20tsc-6366f1)](.github/workflows/ci.yml)
[![Formatting: Ruff format](https://img.shields.io/badge/formatting-ruff%20format-111827)](.github/workflows/ci.yml)
[![Platforms](https://img.shields.io/badge/platforms-linux%20%7C%20macOS%20%7C%20windows-0ea5e9)](.github/workflows/release.yml)
[![Last Commit](https://img.shields.io/github/last-commit/cortega26/DNSpect)](https://github.com/cortega26/DNSpect/commits/main/)

![DNSpect live benchmark demo](docs/screenshots/readme-demo.gif)

## Problem Statement
Most "DNS speed test" pages run from a remote browser context or cloud vantage point, so they measure someone else's network path. DNSpect runs on your machine, sends real DNS queries to candidate resolvers, and ranks outcomes using latency, failure rate, and stability metrics.

## Features
### Core features
- Local DNS benchmark API (`FastAPI`) and web UI (`React + Vite + TypeScript`).
- **49 DNS providers** in the catalog with metadata (goals, tags, features) used for test selection.
- **Scoring profiles** — five profiles (`speed`, `security`, `privacy`, `ad-blocking`, `family`) with goal-aware ranking weights. A scoring profile controls ranking policy; the immutable target snapshot records exactly which resolvers were measured. See `docs/PROFILE_MODEL.md`.
- **Encrypted DNS benchmarking** — full DoT (DNS-over-TLS) and DoH (DNS-over-HTTPS) support with protocol selector in UI and capability filtering.
- **Matched protocol comparison** — a single parent session measures one fixed common resolver set across UDP/DoT/DoH with the same query plan, then reports matched deltas. Resolvers missing a DoT hostname or DoH URL are excluded with a reason rather than guessed; results carry endpoint and transport caveats (local methodology, not a general privacy or performance claim). See `docs/PROTOCOL_COMPARISON_METHODOLOGY.md`.
- **Region target scoping** — a region choice selects the measured resolver set (auto-detected through the approved egress GeoIP flow, or chosen manually). See `docs/REGION_TARGETING.md`.
- Resolver benchmarking with per-run query samples and progress reporting.
- Engine selection:
  - `drill` on Linux when available.
  - `dnspython` fallback (including Windows).
- Ranking metrics per resolver:
  - `avg`, `median`, `p95`, `min`, `max`, timeout/failure rates, consistency ratio.
- **Blocking efficacy metric** — benchmark against 9 known-blocked domains with sinkhole IP detection, per-resolver blocking percentage.
- **DNSSEC validation detection** — per-resolver readiness check with badge indicators.
- **NXDOMAIN hijacking detection** — random-probe detection of resolvers forging responses for non-existent domains.
- Deterministic ranking output and recommended resolver selection.
- CSV and JSON export endpoints.
- System DNS detection on Linux/macOS/Windows.

### Advanced features
- Guided "apply DNS" modal with platform-aware instructions and verification probe.
- Live ranking panel during benchmark execution with motion budget controls.
- **Dashboard panel** with post-benchmark overview metrics.
- **Run history sidebar** for browsing and comparing past runs.
- **Historical run comparison** — deterministic side-by-side deltas only for runs whose immutable run manifests match exactly (resolver targets, query plan, protocol, scoring policy, and catalog digest). Runs that do not share a manifest are never shown a numerical diff; they get an explicit reason instead. Comparisons are local, require matching immutable manifests, and do not prove a causal resolver regression.
- **Protocol badges** (UDP/DoT/DoH) in ranking and history views.
- Optional sample inclusion (`include_samples=1`) for deep diagnostics.
- Last-run persistence in browser storage with schema/version invalidation.
- Runtime queue controls for concurrency and queued jobs via environment variables.

### Reliability guarantees
- Queue pressure protection: benchmark start is rejected when `running + queued` exceeds configured capacity.
- Terminal state retention is bounded by TTL and max retained states.
- Persistence failure is non-fatal: benchmark completes and exposes `run_storage_warning`.
- Progress timestamps are monotonic (`last_sample_at` does not move backwards).
- Ranking and recommendation determinism are test-gated against input-order variance.

### Performance optimizations
- Background execution via `ThreadPoolExecutor`.
- Query schedule precomputed per run to avoid repeated scheduling overhead.
- Sample-heavy payloads excluded by default (`samples: []` + `sample_count`) unless explicitly requested.
- Frontend chart rendering supports Top-N limiting for readability/perf.
- Live ranking animation is automatically reduced/disabled for large row counts or reduced-motion users.

### Platform compatibility
- Release binaries generated for:
  - Linux x64 (`dnspect-linux-x64`)
  - Windows x64 (`dnspect-windows-x64.exe`)
  - macOS arm64 (`dnspect-macos-arm64`)
- See `docs/RELEASE_VERIFY.md` for the verified release workflow and per-asset checks.
- Development scripts for Linux/macOS (`scripts/dev.sh`) and Windows (`scripts/dev.ps1`).
- DNS detection methods:
  - Linux: `resolvectl` then `/etc/resolv.conf`
  - macOS: `scutil --dns`, fallback `networksetup`
  - Windows: `ipconfig /all`, fallback `netsh`

### Privacy considerations
- Local-first execution: no telemetry or analytics pipeline in this repo.
- Benchmark network traffic is DNS query traffic to the resolvers you selected.
- When automatic region detection is enabled (the default until a manual region is chosen), the app makes one request to `https://api.ipify.org?format=json` (IP address only, 5-second timeout, no caching or retries) and one local GeoIP lookup against the bundled backend; the result is used only to derive the default target scope and falls back silently when unavailable. See `docs/REGION_TARGETING.md` for the approved policy.
- Benchmark metadata is persisted under a platform user data path resolved by `platformdirs` (`user_data_path("dnspect", "DNSpect") / "runs"`); sample persistence is disabled by default unless `DNS_SPEED_LAB_PERSIST_SAMPLES=1`.
- UI stores "last run" in browser local storage for convenience.

## Security Model
### Attack surface
- Inbound surface: local HTTP server (`uvicorn`) on `127.0.0.1:8000` by default.
- Browser/API surface: endpoints under `/api/*` for benchmark/probe/export.
- Browser-origin policy surface: CORS is restricted to localhost/127.0.0.1 origins (including localhost regex ports).
- Outbound surface: DNS queries to configured resolver IPs; one approved public-IP request (`api.ipify.org`) and a local GeoIP lookup during automatic region detection; local OS command execution for DNS detection (`resolvectl`, `scutil`, `networksetup`, `ipconfig`, `netsh`) and optional `drill`.

### Input validation model
- Resolver input must be literal IP addresses (IPv4/IPv6); invalid values fail validation.
- Domain input must match strict hostname regex and is normalized/lowercased.
- Hard limits exist for workload control:
  - Benchmark: `runs 1..300`, `timeout_sec 0.1..10`, max 256 resolvers/queries.
  - Probe: max 8 resolvers, 32 queries, `runs_per_resolver 1..5`, `timeout_sec 0.1..5`.

### SSRF protections and applicability
- Traditional HTTP SSRF is not applicable by design because the backend does not fetch arbitrary URLs.
- Resolver targets are constrained to validated IP literals; domain names are query payloads, not network destinations.
- DNS queries can still reach private/internal IP resolvers if the local operator provides them. This is expected behavior for local diagnostics.

### Deterministic behavior guarantees
- Stable scoring and ranking keys are applied before response/export.
- Tie-breaking includes resolver identity for stable order.
- Tests explicitly verify ranking/recommendation invariance when resolver input order changes.

### Sandboxing, throttling, and validation layers
- Validation layer: `pydantic` request models + normalization/deduplication.
- Throttling layer: bounded worker pool plus queue limits.
  - `DNS_SPEED_LAB_MAX_CONCURRENT_JOBS`
  - `DNS_SPEED_LAB_MAX_QUEUED_JOBS`
  - `DNS_SPEED_LAB_MAX_QUERY_ATTEMPTS` — aggregate query attempt limit (default: 10000)
  - `DNS_SPEED_LAB_MAX_ESTIMATED_DURATION_SEC` — aggregate estimated duration limit (default: 14400, 4 hours)
- Aggregate admission is deterministic based on resolver count × (runs + blocking probes + 2 diagnostics). Rejected jobs raise a descriptive `ValueError` before state or persistence is created.
- No OS sandboxing/isolation layer is implemented; process runs with current user privileges.
- Subprocess calls avoid `shell=True`, reducing command injection surface.

### Explicit trust boundaries
- Boundary 1: Browser/UI input is untrusted until backend validation.
- Boundary 2: Backend process is trusted code, but depends on local OS/network state and resolver responses (untrusted external systems).
- Boundary 3: If host binding is changed from localhost to a network-accessible interface, threat model changes materially (auth/TLS are not built in).

## Architecture Overview
```mermaid
flowchart TD
  A[User Input from React UI] --> B[FastAPI Endpoint]
  B --> C[Pydantic Validation and Normalization]
  C --> D[BenchmarkManager Queue and State]
  D --> E{Protocol Selection}
  E -->|UDP| F{Engine Selection}
  E -->|DoT| G[DoT Query Runner\nvia dns.query.tls]
  E -->|DoH| H[DoH Query Runner\nvia dns.query.https]
  F -->|Linux + drill available| I[drill Query Runner]
  F -->|Windows or drill unavailable| J[dnspython Query Runner]
  G --> K{Goal-Aware Scoring}
  H --> K
  I --> K
  J --> K
  K --> L[Normalized Scoring and Ranking]
  L --> M[Recommended Resolver Selection]
  M --> N[API Response, JSON Export, CSV Export]
  L --> O[(Optional Run Persistence)]
```

Detailed design notes: `docs/ARCHITECTURE.md`.
Architecture deep dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Installation
### Option A: Run from source (dev)
Prerequisites:
- Python `>=3.13`
- Node.js `24.x`

Linux/macOS:
```bash
bash scripts/dev.sh
```

Windows (PowerShell):
```powershell
.\scripts\dev.ps1
```

### Option B: Use release binary
1. Download platform asset from GitHub Releases.
2. Run binary.
3. Open `http://127.0.0.1:8000`.

Release verification guide: `docs/RELEASE_VERIFY.md`.

## Usage Examples
### Start benchmark via UI
- Open app.
- Choose resolvers, goal (`speed`, `security`, `privacy`, `ad-blocking`, `family`), and protocol (`UDP`, `DoT`, `DoH`).
- Select mode (`quick`, `standard`, `exhaustive`).
- Start benchmark and watch live ranking with protocol badges and blocking/DNSSEC indicators.
- Export CSV/JSON when done.

### Start benchmark via API
```bash
curl -sS -X POST http://127.0.0.1:8000/api/benchmarks \
  -H 'Content-Type: application/json' \
  -d '{
    "mode": "standard",
    "runs": 30,
    "timeout_sec": 2,
    "goal": "speed",
    "protocol": "dot",
    "resolvers": ["1.1.1.1", "8.8.8.8"],
    "queries": ["cloudflare.com", "google.com"]
  }'
```

Poll status:
```bash
curl -sS http://127.0.0.1:8000/api/benchmarks/<benchmark_id>
```

Export:
```bash
curl -sS -o dnspect.csv http://127.0.0.1:8000/api/benchmarks/<benchmark_id>/export.csv
curl -sS -o dnspect.json "http://127.0.0.1:8000/api/benchmarks/<benchmark_id>/export.json?include_samples=1"
```

### Run local quality gates
```bash
make backend-check
make backend-semgrep
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

## Why This App Is Better Than Typical Online DNS Checkers
| Dimension | Typical online checker | DNSpect |
|---|---|---|
| Measurement vantage point | Remote browser/cloud path | Your machine and network path |
| DNS execution model | Often indirect/proxy-based checks | Real DNS lookups via `drill`/`dnspython`/`dns.query.tls`/`dns.query.https` |
| Protocol support | UDP only | UDP + DNS-over-TLS (DoT) + DNS-over-HTTPS (DoH) |
| Scoring dimensions | Usually simple latency-only ranking | Latency + failure rate + stability + blocking efficacy + reliability guardrail |
| Goal-aware scoring | None | 5 benchmark goals with weighted scoring (speed, security, privacy, ad-blocking, family) |
| Security detection | None | DNSSEC validation, NXDOMAIN hijacking, blocking efficacy per resolver |
| Determinism | May vary with server-side cohort/load | Deterministic ranking/scoring path with stable tie-breaks |
| Input controls | Limited resolver/query control | Explicit resolvers, query list, run count, timeout, mode, protocol, goal |
| Privacy | Traffic and metadata often leave local environment | Local-first operation; no telemetry codepath |
| Provider catalog | Usually a handful of hardcoded resolvers | 50 providers across all regions with metadata |
| Validation guarantees | Usually undocumented | Enforced request validation and hard workload bounds |

## Roadmap

- [ ] Continuous monitoring mode — background daemon re-checking resolvers at intervals
- [ ] Scheduled/recurring benchmarks with persistent history
- [ ] Configurable alerting when a resolver degrades beyond threshold
- [ ] CLI-only mode (headless, no UI dependency)

## Contributing
- Start here: `CONTRIBUTING.md`
- Security reporting: `SECURITY.md`
- Provider dataset notes: `docs/PROVIDERS.md`

## License
MIT. See `LICENSE`.

---

Built and maintained by **Carlos Ortega** — automation, data systems, and web technical hygiene consulting. Portfolio and services: **[tooltician.com](https://tooltician.com/)**.

*Part of the [Tooltician](https://tooltician.com) ecosystem — herramientas de red, local-first y verificables.*
