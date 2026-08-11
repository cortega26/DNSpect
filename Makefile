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
FLATPAK_PIP_GENERATOR ?= flatpak-pip-generator
FLATPAK_BUILDER ?= flatpak-builder
FLATPAK_BUILDER_LINT ?= flatpak-builder-lint

# Release inputs: python3-requirements.json is generated from requirements.txt;
# generated-sources.json is generated from frontend/package-lock.json. Neither
# generated file is safe to hand-edit.
flatpak-python-deps:
	$(FLATPAK_PIP_GENERATOR) --runtime=org.freedesktop.Sdk//25.08 \
		--requirements-file=packaging/flatpak/requirements.txt \
		--wheel-arches=x86_64,aarch64 \
		--prefer-wheels=pydantic-core,uvloop,httptools,watchfiles \
		--output=packaging/flatpak/python3-requirements

flatpak-deps:
	cd frontend && flatpak-node-generator npm --stub-requests package-lock.json -o ../packaging/flatpak/generated-sources.json

flatpak-build:
	$(FLATPAK_BUILDER) --force-clean --repo=$(FLATPAK_BUILDDIR)/repo $(FLATPAK_BUILDDIR)/build $(FLATPAK_MANIFEST)

flatpak-validate: flatpak-build
	$(FLATPAK_BUILDER_LINT) manifest $(FLATPAK_MANIFEST)
	# --exceptions: pre-submission builds hit the registered
	# appstream-external-screenshot-url exception (screenshots are mirrored
	# by Flathub after submission); real errors are not suppressed.
	$(FLATPAK_BUILDER_LINT) --exceptions builddir $(FLATPAK_BUILDDIR)/build

flatpak-install:
	flatpak-builder --user --install --force-clean $(FLATPAK_BUILDDIR)/build $(FLATPAK_MANIFEST)

plans-archive:
	python3 scripts/archive_plans.py

.PHONY: flatpak-deps flatpak-python-deps flatpak-build flatpak-validate flatpak-install plans-archive
