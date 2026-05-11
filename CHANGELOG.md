# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [1.1.0] - 2026-05-09

### Highlights

- Added: **Goal system** — five benchmark goals (speed, security, privacy, ad-blocking, family) with goal-aware scoring weights and provider filtering. Segmented control UI replaces single-mode selection. `BenchmarkGoal` enum, `GOAL_WEIGHTS` in stats engine, `goal` field in benchmark state and request.
- Added: **GeoIP integration** — new `/api/geoip` endpoint with optional MaxMind database lookup, `geoip.py` module, client-side public IP detection via ipify, and automatic region detection from browser locale.
- Added: **Region-based provider grouping** — `region`, `country`, and `goals` fields on every provider; UI filters providers by detected region; region override selector in dashboard.
- Added: **7 new DNS providers** — dns0.eu, CZ.NIC, Digitalcourage, AliDNS, DNSPod, Neustar, Comodo — expanding the catalog from 9 to 16 providers.
- Added: **UI overhaul (May 2026)** — hero SVG illustration with decorative network graph, compact header with brand icon, redesigned controls with segmented mode/goal selectors, refined dark theme palette (lower contrast, cooler tones), layered shadow system, reduced border radii, tightened layout (max-width 1180→1000px), live ranking waiting animation, rank badges (#1/#2/#3), fade-in sections, and richer empty states.
- Added: **~60 new translation keys** across ES/EN/PT covering goals, regions, provider counts, live ranking status, and empty state messages.
- Added: **Optional GeoIP dependency** `maxminddb==2.7.0` under `[tool.poetry.extras] geoip` in `pyproject.toml`.
- Accessibility: WCAG 2.2 improvements — proper `role` attributes on segmented controls, keyboard navigation in locale dropdown (`role=menuitemradio`, arrow keys), `aria-busy` on loading states, `focus-visible` ring refinements.
- Build/CI: Updated GitHub Actions workflows and dependency version to v6; bumped rollup dependency via dependabot.
- Fixed: aarch64 pydantic-core Flatpak source URL for ARM64 builds.
- Flatpak: GUI options improvements, enhanced Flatpak integration paths.

### Full details by area

#### Goal System & Scoring

- Added: `BenchmarkGoal` enum (`speed`, `security`, `privacy`, `ad-blocking`, `family`) in `models.py`.
- Added: `GOAL_WEIGHTS` dictionary mapping each goal to latency/reliability/stability weight triples. Speed favors latency (0.6/0.3/0.1); family favors reliability (0.30/0.55/0.15).
- Added: Goal parameter accepted in `BenchmarkRequest`, propagated through `BenchmarkConfig` → `BenchmarkState` → `apply_normalized_scoring()`.
- Changed: `apply_normalized_scoring()` now accepts optional `goal` parameter; scoring uses goal-specific weights instead of hardcoded (0.6, 0.3, 0.1).
- Added: Goal selector in `DashboardControls.tsx` — segmented control with 5 options, each with label and help text tooltip.
- Added: Provider filtering by goal — non-speed goals filter the provider catalog to only those matching the selected goal.
- Added: `providersByGoal()` utility and `onGoalChange()` handler that auto-selects matching resolvers on goal switch.

#### GeoIP & Region Detection

- Added: `/api/geoip` GET endpoint in `main.py` with optional `ip` query param; falls back to `request.client.host`. Returns `country_code`, `country_name`, `region`, `city`, `source`.
- Added: `geoip.py` module — MaxMind GeoLite2 database lookup with country-to-region mapping, graceful fallback on missing DB.
- Added: Optional `maxminddb==2.7.0` dependency under `geoip` extras group.
- Added: `getPublicIp()` API client — fetches public IP from ipify with 5s timeout.
- Added: `lookupGeoIp()` API client — calls `/api/geoip` endpoint.
- Added: `detectRegion()` utility — extracts region from `navigator.language` via `Intl.Locale`.
- Added: `providersByRegion()` filter — shows providers matching detected or selected region plus global providers.
- Added: `regionLabel()` formatter and `region_override` selector in dashboard controls.
- Added: Hero meta bar showing detected region, provider count, and system DNS count.

#### Provider Catalog Expansion

- Added: `region`, `country`, and `goals` fields to all 9 existing providers.
- Added: 7 new providers with full metadata, tags, features, and Spanish notes:
  - **dns0.eu** — European GDPR-compliant DNS with malware blocking.
  - **CZ.NIC** — Czech security-focused DNS.
  - **Digitalcourage** — German privacy-focused DNS.
  - **AliDNS** — Alibaba DNS for Asia.
  - **DNSPod** — Tencent DNS for Asia.
  - **Neustar** — Threat intelligence DNS.
  - **Comodo** — Comodo Secure DNS.
- Updated: `FALLBACK_PROVIDERS` in `App.tsx` with new schema (region/goals fields).

#### Frontend UI/UX

##### Hero & Header

- Added: SVG decorative network graph illustration in hero section with animated dots and connection paths.
- Added: Compact brand header with clock icon + "DNSPect" wordmark.
- Added: Hero meta bar with region label (globe icon), provider count (grid icon), system DNS count (checkmark icon).
- Restructured: Theme toggle and locale dropdown moved from below-hero to top header bar.
- Added: `fade-in-section` CSS class for section entrance animation.

##### Controls Panel

- Changed: Mode selector from chip grid to `segmented-control` with `role=radiogroup`.
- Added: Goal selector as second segmented control row.
- Added: Region override dropdown in controls.
- Changed: Provider grouping — dynamic group sorting by priority (Global=0, Privacidad=1, regional groups sorted alphabetically, ISP detectados=99).

##### Ranking & Results

- Added: Rank badges with distinct styling — `badge-rank-1`, `badge-rank-2`, `badge-rank-3` (gold/silver/bronze accents).
- Added: `badge-rec-primary` and `badge-rec-secondary` for recommended/secondary resolver badges.
- Added: Live ranking waiting animation — 5 pulsing bars with staggered delay.

##### Empty States

- Added: Empty state body text in ChartsPanel (`filters.empty`).
- Refined: Empty state icon stroke width and layout gap.

#### CSS Architecture

- Changed: Shadow system — replaced single `shadow-sm`/`shadow` with layered shadows (`shadow-sm`: 2 layers, `shadow`: 2 layers, new `shadow-lg`: 2 layers).
- Changed: Dark theme colors — reduced saturation (`--bg`: `#080C14→#070A12`, `--surface-2`: `#1A2330→#18202F`, `--text`: `#EDF0F5→#E8ECF2`, `--muted`: `#93A0B8→#8896B0`, `--border`: `#2A3650→#263048`).
- Changed: `--accent-soft` opacity from 0.08 to 0.07, `--success-soft` from 0.1 to 0.08.
- Changed: Border radii reduced by 2px (sm: 10→8, md: 14→12, lg: 18→16).
- Changed: App shell max-width from 1180px to 1000px, padding from 32px to 48px sides.
- Changed: Background gradient — added second radial gradient at bottom-right.
- Added: `min-height: 100dvh` on body.
- Added: `h3` font-size normalization (1rem).
- Added: `card-compact-controls`, `controls-mode-col`, `controls-goal-col`, `segmented-control`, `live-ranking-waiting` styles.

- Fixed: Linux packaged binary startup crash (missing `backports.tarfile` in PyInstaller bundle).
- Build/CI: Added packaged artifact smoke tests in CI/release to prevent regression.

## [1.0.0] - 2026-02-22

### Highlights

- Changed: Stabilized resolver ranking semantics with deterministic ordering and fixed-reference reliability normalization for cross-run comparability (`3642066`).
- Added: Introduced queued benchmark lifecycle and surfaced persistence warnings without failing completed runs (`3642066`).
- Added: Added guided DNS apply flow with copy helpers and post-change probe verification workflow in the UI (`2b37d73`).
- Added: Added live ranking, recommendation panels, and richer in-progress telemetry (health, ETA, resolver context) in the dashboard (`425f363`, `2b37d73`).
- Added: Expanded OS DNS detection with macOS `scutil`/`networksetup` support plus improved IPv6 normalization and parsing (`2b37d73`, `3642066`).
- Build/CI: Hardened release pipeline with architecture checks, checksum generation, optional GPG signing, and deterministic build inputs (`2b37d73`, `04a87d1`, `c774665`).
- Changed: Switched macOS release channel to arm64-only artifacts and removed x64 publication/verification references (`1b5f843`).
- Security: Upgraded critical dependencies and security gates (FastAPI/Starlette/python-multipart/esbuild, plus Bandit/Semgrep in CI) (`3642066`, `bf694f0`, `a459838`).

### Full details by area

#### Frontend UX & UI

- Added: Added `LiveRankingPanel`, `RecommendedResolverPanel`, and `ResolverRankingPanel` for incremental ranking and recommendation visibility (`425f363`).
- Added: Added guided apply modal with platform-specific DNS instructions, clipboard actions (IPv4/IPv6/all), and in-app verification result rendering (`2b37d73`).
- Added: Added i18n and theme support (ES/EN/PT, toggleable theme, persisted preferences) and later extracted dedicated `useI18n`/`useTheme` hooks (`d163882`, `79b90f4`).
- Changed: Extended benchmark start payload from UI to include optional custom queries entered by users (`b514fdb`).
- Fixed: Added fallback resolver provider catalog when providers API is unavailable, while still loading system DNS when possible (`ab7ea58`).

#### Backend benchmarking/scoring/statistics

- Added: Added score component fields and normalization outputs (`score_*`, `normalized_*`, `reliability_penalty`, `max_rel_penalty`, `is_unreliable`) to benchmark stats and CSV export (`425f363`, `3642066`).
- Changed: Reworked reliability normalization to use a fixed guardrail reference penalty instead of cohort-dependent max penalty (`3642066`).
- Changed: Standardized per-run query schedule across resolvers and sorted ranked output with deterministic tie-breaking (`3642066`).
- Added: Added recommendation selection with warning fallback when all candidates exceed reliability guardrail (`425f363`, `3642066`).
- Added: Added `/api/probe` with validated `ProbeRequest` and structured per-resolver probe results for quick verification flows (`2b37d73`).

#### Reliability/probing/verification

- Added: Added queue-aware benchmark state machine (`queued` -> `running` -> terminal) and queue-capacity enforcement (`3642066`).
- Added: Added terminal-state cleanup controls (TTL and retained-state cap) for manager memory/lifecycle hygiene (`3642066`).
- Added: Added non-fatal run persistence warning propagation via `run_storage_warning` (`3642066`).
- Changed: Renamed runtime failure status from `error` to `failed` and expanded status surface to include `queued` and `cancelled` (`3642066`).
- Added: Added lifecycle/determinism/storage-warning regression tests validating queue behavior and order-invariant ranking (`3642066`).

#### OS DNS detection

- Added: Added macOS resolver detection via `scutil --dns` with `networksetup` fallback (`2b37d73`).
- Changed: Expanded resolver parsing to robustly normalize/deduplicate IPv4 and IPv6 tokens (including scoped IPv6 forms) (`3642066`).
- Added: Added `error_detail` propagation in system DNS payloads for non-fatal detection failures (`2b37d73`, `3642066`).
- Added: Added macOS and IPv6-focused detection test coverage, including system payload behavior (`425f363`, `3642066`).

#### CI/CD & release pipeline

- Build/CI: Reworked release artifact matrix with explicit names/architectures and pinned Node/Python setup for reproducible packaging (`3642066`, `04a87d1`).
- Build/CI: Added macOS artifact architecture verification (`file` + `lipo`) and strengthened mismatch/universal-binary rejection rules (`04a87d1`, `c774665`).
- Build/CI: Added checksum manifest generation and optional GPG signature creation/publication in release workflow (`2b37d73`, `04a87d1`).
- Changed: Removed macOS x64 artifacts from release publication and verification docs; retained arm64 artifact path only (`1b5f843`).

#### Security & dependency updates

- Security: Upgraded FastAPI to `0.129.2`, pinned Starlette to `0.49.3`, and bumped `python-multipart` to `0.0.22` (`3642066`, `bf694f0`).
- Security: Upgraded frontend `esbuild` from `0.21.5` to `0.27.3` via dependency updates (`a459838`, `8b9e1d9`).
- Build/CI: Added backend dependency constraints lockfile and switched CI/release installs to constrained mode (`3642066`, `04a87d1`).
- Build/CI: Added Bandit, Black, and Semgrep checks to CI quality/security gates (`3642066`).

#### Docs

- Docs: Added reproducible build documentation in `docs/BUILD.md` (`3642066`).
- Docs: Added release verification guide and updated it for the arm64-only macOS release policy (`2b37d73`, `04a87d1`, `1b5f843`).
- Docs: Added motion accessibility validation checklist (`docs/MOTION_VALIDATION.md`) (`2b37d73`).
- Docs: Expanded UX documentation with screenshot sets and frontend-specific README (`425f363`, `2b37d73`).
- Docs: Refreshed top-level README content and assets, including banner and architecture-diagram updates (`d163882`, `c2294d2`, `a28cf96`, `c807aa2`).

### Release-impact notes

- Changed: macOS artifact policy is arm64-only for this release; `dnspect-macos-x64` publishing/verification references were removed (`1b5f843`).
- Fixed: Ranking determinism is now order-invariant with explicit regression coverage for resolver input order independence (`3642066`).
- Changed: Scoring semantics now use fixed-reference reliability normalization (`RELIABILITY_REFERENCE_PENALTY`) instead of cohort-relative normalization (`3642066`).
- Added: API responses now include additive fields such as `run_storage_warning`, `recommended_resolver`, `recommendation_warning`, plus richer `progress` metadata (`425f363`, `3642066`).
- Changed: Backward-compatibility concern: status enum changed (`error` -> `failed`) and now includes `queued`/`cancelled`; strict client parsers may require updates (`3642066`).
- Changed: Backward-compatibility concern: macOS x64 consumers must migrate to arm64 artifacts for this channel (`1b5f843`).

## [0.2.0] - 2026-02-21

### Added

- Community and governance docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENSE`.
- Tooling quality gates:
  - Backend `pyproject.toml` with `ruff`, `mypy`, `pytest`.
  - Frontend `eslint`, `typecheck`, `build` scripts.
- CI workflow `.github/workflows/ci.yml`.
- Release workflow `.github/workflows/release.yml`.
- Failure classification per sample (`failure_kind`).
- New resolver metrics: `success_rate`, `timeout_rate`, `consistency_ratio`, `p95_minus_median_ms`.
- API support for lightweight payloads via `include_samples`.
- UX upgrades: ranking filters, metric help, recommendation card, top-N charts.
- DX scripts: `scripts/dev.sh`, `scripts/dev.ps1`, `scripts/smoke_test.sh`, `scripts/smoke_test.ps1`.
- Packaging Option B with PyInstaller via `scripts/package_backend.py`.
- `docs/TROUBLESHOOTING.md`.

### Changed

- Backend now persists run metadata always; samples persistence optional (`DNS_SPEED_LAB_PERSIST_SAMPLES=1`).
- Frontend now fetches sample payload only on-demand for resolver detail modal.
- Backend serves static frontend in packaged mode.

### Security

- Maintained strict resolver/domain validation and bounded workloads.
- Continued prohibition of shell-based command execution (`shell=True` not used).
