.PHONY: backend-install backend-dev backend-check backend-semgrep frontend-install frontend-dev frontend-check dev smoke dependency-audit

backend-install:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r constraints.txt -e .[dev]

backend-dev:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload

backend-check:
	cd backend && . .venv/bin/activate && ruff check . && ruff format --check . && mypy && bandit -q -c pyproject.toml -r app && pytest -q

backend-semgrep:
	@TMP_SEMGREP_ENV=$$(mktemp -d); \
	trap 'rm -rf "$$TMP_SEMGREP_ENV"' EXIT; \
	python3 -m venv "$$TMP_SEMGREP_ENV"; \
	. "$$TMP_SEMGREP_ENV/bin/activate"; \
	pip install --disable-pip-version-check -q semgrep==1.152.0; \
	cd backend; \
	semgrep scan --config p/python --error --exclude tests app

frontend-install:
	cd frontend && npm ci

frontend-dev:
	cd frontend && npm run dev

frontend-check:
	cd frontend && npm run lint && npm run typecheck && npm run build

dev:
	bash scripts/dev.sh

smoke:
	bash scripts/smoke_test.sh

dependency-audit:
	cd backend && . .venv/bin/activate && pip-audit -r constraints.txt --no-deps --progress-spinner off
	cd frontend && npm audit --package-lock-only

# Flatpak
FLATPAK_MANIFEST := io.github.cortega26.DNSpect.yaml
FLATPAK_BUILDDIR := build-flatpak

flatpak-deps:
	cd frontend && flatpak-node-generator npm --ignore-shasums=rollup package-lock.json -o ../packaging/flatpak/generated-sources.json

flatpak-build:
	flatpak-builder --force-clean --repo=$(FLATPAK_BUILDDIR)/repo $(FLATPAK_BUILDDIR)/build $(FLATPAK_MANIFEST)

flatpak-validate: flatpak-build
	flatpak-builder-lint manifest $(FLATPAK_MANIFEST)
	flatpak-builder-lint appdir $(FLATPAK_BUILDDIR)/build

flatpak-install:
	flatpak-builder --user --install --force-clean $(FLATPAK_BUILDDIR)/build $(FLATPAK_MANIFEST)

.PHONY: flatpak-deps flatpak-build flatpak-validate flatpak-install
