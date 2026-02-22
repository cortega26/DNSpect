# DNSpect Release Blockers Closeout (v1 pre-release)

Date: 2026-02-22

## Blocker 1: Starlette DoS vulnerability (GHSA/CVE)

### What was fixed
- Upgraded FastAPI to `0.129.2` and pinned Starlette to `0.49.3`.
- Kept Starlette explicitly pinned in backend dependencies.

### Why
- Removes known vulnerable Starlette versions from runtime file-serving paths (`StaticFiles`/`FileResponse`).

### Files
- `backend/pyproject.toml`
- `backend/constraints.txt`

### Validation
- `pip-audit` (installed environment): no known vulnerabilities.
- `pip-audit -r backend/constraints.txt`: no known vulnerabilities.
- Backend test suite passes.

## Blocker 2: Benchmark start hard-fail on unwritable run metadata path

### What was fixed
- Added user-writable default run storage directory via `platformdirs` (`user_data_path("dnspect", "DNSpect")/runs`).
- Persistence writes now handle `OSError` safely; benchmark execution continues.
- Added additive API field: `run_storage_warning`.
- Warning includes bounded class/detail text, no stack traces.

### Why
- Prevents 500/start failure when local persistence path is unavailable/unwritable.

### Files
- `backend/app/runner.py`
- `backend/pyproject.toml`
- `backend/tests/test_manager_lifecycle.py`
- `backend/tests/test_storage_warning_api.py`

### Validation tests
- `test_start_succeeds_when_run_storage_is_not_writable`
- `test_api_exposes_run_storage_warning_when_persistence_fails`

## Blocker 3: Build/release reproducibility gaps

### What was fixed
- Pinned Node from `lts/*` to exact `22.14.0` in CI and release workflows.
- Added lock-style constraints file generated from `pyproject` extras:
  - `backend/constraints.txt`
- CI and release workflows now install backend deps with constraints:
  - `pip install -c ... -e .[dev]`
  - `pip install -c ... -e "./backend[pack]"`
- Added reproducible build documentation.
- Updated local scripts to use constrained backend installs.

### Why
- Reduces dependency/toolchain drift between runs and across tags.

### Files
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `backend/constraints.txt`
- `backend/requirements.txt`
- `docs/BUILD.md`
- `scripts/dev.sh`
- `scripts/dev.ps1`
- `scripts/smoke_test.sh`
- `scripts/smoke_test.ps1`
- `Makefile`

## Blocker 4: Winner changes when resolver input order changes

### What was fixed
- Benchmark scheduler now precomputes one shared query sequence per run index.
- Every resolver is measured against the same ordered query sequence.

### Why
- Removes resolver-order coupling from query selection and stabilizes rank output.

### Files
- `backend/app/runner.py`
- `backend/tests/test_ranking_determinism.py`

### Validation test
- `test_benchmark_ranking_is_independent_from_resolver_input_order`

## Blocker 5: Cohort-relative scoring flips A/B when adding unrelated C

### What was fixed
- Reliability normalization no longer depends on cohort max penalty.
- New reliability normalization uses a fixed absolute reference:
  - `RELIABILITY_REFERENCE_PENALTY = -log(1 - RELIABILITY_GUARDRAIL_THRESHOLD)`
- `max_rel_penalty` field is now this fixed reference value, preserving contract field presence.

### Why
- A vs B order no longer changes due to unrelated third resolver composition.

### Files
- `backend/app/stats.py`
- `backend/tests/test_stats.py`

### Regression tests
- `test_ab_order_is_invariant_when_unrelated_bad_resolver_is_added`
- `test_reliability_normalization_uses_fixed_reference_penalty`

## High: Unbounded queue and state retention

### What was fixed
- Added queue controls:
  - max concurrent workers
  - max queued jobs
- Added explicit lifecycle state `queued` (plus `running/done/failed/cancelled` handling).
- Added TTL cleanup and bounded terminal retention.
- Queue saturation returns validation error instead of unbounded acceptance.

### Files
- `backend/app/runner.py`
- `backend/tests/test_manager_lifecycle.py`
- `frontend/src/lib/types.ts`
- `frontend/src/App.tsx`

### Validation tests
- `test_queue_limit_is_enforced_and_queued_state_is_visible`
- `test_terminal_ttl_cleanup_removes_old_states`

## High: Linux/Windows DNS detection dropped IPv6 resolvers

### What was fixed
- Replaced IPv4-only extraction path with `ipaddress` token parsing for Linux/Windows detection flows.
- Output schema unchanged.

### Files
- `backend/app/detect_dns.py`
- `backend/tests/test_detect_dns_ipv6.py`

### Validation tests
- `test_detect_linux_dns_resolvectl_keeps_ipv4_and_ipv6`
- `test_detect_windows_dns_ipconfig_keeps_ipv4_and_ipv6`
- `test_detect_windows_dns_netsh_fallback_keeps_ipv6`

## Final validation results

- Backend tests: `38 passed`
- Frontend typecheck: pass
- Frontend tests: `32 passed`
- `pip-audit`: no known vulnerabilities
- `pip-audit -r backend/constraints.txt`: no known vulnerabilities
- `npm audit --omit=dev`: `found 0 vulnerabilities`

## Remaining non-blocking debt

- Dev-only npm audit findings still exist in lint/tooling dependency chain when running full `npm audit` (not runtime bundle; `--omit=dev` is clean).
