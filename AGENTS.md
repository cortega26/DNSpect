# DNSpect — AGENTS.md

## Identity

DNSpect is a DNS performance lab. Resolvers are test targets, not products. Value comes from measurement integrity, not catalog size.

## Toolchain

- Backend: FastAPI, Python **>=3.13**, Pydantic v2, dnspython. Entrypoint `backend/app/main.py`; venv at `backend/.venv`.
- Frontend: React 18 + Vite + TypeScript, Node **24.x** (engine-pinned). Vite root is `frontend/`.
- Install: `cd backend && python3 -m venv .venv && pip install -c constraints.txt -e .[dev]` and `cd frontend && npm ci` (lockfile — never `npm install`).

## Commands

```bash
make dev                 # both servers: backend :8000, frontend :5173 (same as scripts/dev.sh)
make backend-check       # ruff check + ruff format --check + mypy + bandit + pytest (CI order)
make frontend-check      # npm run lint && npm run typecheck && npm run build
make smoke               # smoke test against a backend on port 8001 (not 8000)
make flatpak-validate    # flatpak-builder build + manifest/appdir lint
make backend-semgrep     # SAST; installs pinned semgrep into a throwaway venv
cd backend && pytest tests/test_stats.py::test_x -q    # single test
cd frontend && npm test                                 # vitest (co-located *.test.ts in src/lib/)
```

Formatting is enforced by `ruff format` (black is a dev dep but never the gate). `npm run build` already runs typecheck; `npm test` does not build.

## Architecture

| Layer | Responsibility | Location |
|-------|---------------|----------|
| Data | Resolver dataset, query lists | `data/` |
| Domain | Scoring, ranking, profiles | `backend/` |
| Presentation | UI rendering | `frontend/` |
| Measurement | DNS query execution | `backend/` |

- **Determinism**: Same test results + same profile → identical ranking. No randomness in scoring; test-gated (`test_ranking_determinism.py`).
- **Profiles**: User Profiles (ranking policy) and Target Profiles (resolver selection) are independent. Never conflate. See `docs/PROFILE_MODEL.md`.
- **Guardrails**: Never recommend high failure-rate, unstable, or misleading-outlier resolvers.
- Domain logic lives in `backend/app/stats.py`, `runner.py`, `providers.py`; API surface in `main.py`. Deeper docs: `docs/ARCHITECTURE.md`, `docs/PROVIDERS.md`.

## Key Constraints

- **Flatpak**: Desktop app → SEO/social meta tags irrelevant. See `.agents/flathub-compliance.md` for packaging rules (app ID `io.github.cortega26.DNSpect` must match across desktop file, icon, metainfo, manifest). Note `.agents/` is gitignored (local-only).
- **Translations**: ES is source of truth (`frontend/src/lib/i18n-translations.ts`); `TranslationKey` derives from the ES object. EN+PT completeness vs ES is test-gated by `i18n.copy.test.ts` (~317 keys; update both on any key change).
- **Performance**: Recharts (~382 kB) and modals lazy-loaded via `React.lazy`. Keep heavy deps off the main chunk.
- **Accessibility**: Focus traps on modals (`useFocusTrap`), skip-link, keyboard-operable, ARIA labels.
- **Workload caps**: `DNS_SPEED_LAB_MAX_CONCURRENT_JOBS` / `DNS_SPEED_LAB_MAX_QUEUED_JOBS` bound the pool/queue; aggregate work budget is deterministic in `runner.py`.

## Testing

All scoring/ranking changes require unit tests; determinism and backward compat must hold. CI order: backend ruff → format → mypy → bandit → pytest (+ semgrep); frontend lint → typecheck → build → test. Packaged-binary smoke tests (Linux/Windows) run in CI via `scripts/package_backend.py` + `scripts/smoke_packaged_*` — `dist/` outputs are build artifacts.

## Working Conventions

- Feature work is designed as `plans/NNN-title.md`, then merged to main with `merge: plan NNN — title` commits. Status index: `plans/README.md` (reviewer-maintained; don't edit from an implementation branch).
- **Plan archiving**: the moment a plan's row is marked `**Complete**` in `plans/README.md`, its file must be moved to `plans/archive/` with `make plans-archive` (idempotent; rewrites the index links). Planned/blocked/deferred plans stay in `plans/`. Archived plans are immutable historical records — their internal prose and cross-references are never rewritten. `plans/README.md` is the only plan file that remains editable.
- Ad-hoc tasks not backed by a plan: keep a short spec + checklist in the branch, rely on the existing suites (`make backend-check`, `npm test`), and run them after meaningful commits.
- Version parity: bump `backend/pyproject.toml` and `frontend/package.json` together (both 1.2.0). See `docs/RELEASE_CHECKLIST.md`.

## Non-Goals

No brand-based recommendations, no privacy-claims validation. (Region/continent grouping exists via GeoIP + locale — don't add mechanisms that override operator intent.)
