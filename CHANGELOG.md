# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

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
