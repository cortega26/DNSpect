.PHONY: backend-install backend-dev backend-check backend-semgrep frontend-install frontend-dev frontend-check frontend-check-e2e verify dev smoke dependency-audit release-check

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
	cd frontend && npm run lint && npm run typecheck && npm run build && npm test

# Prerequisite: npx playwright install chromium (once, in frontend/)
frontend-check-e2e:
	cd frontend && npx playwright test --reporter=line

# Minimal root dispatch: backend pytest + existing frontend vitest suite.
verify:
	cd backend && . .venv/bin/activate && pytest -q
	cd frontend && npm test

dev:
	bash scripts/dev.sh

smoke:
	bash scripts/smoke_test.sh

dependency-audit:
	cd backend && . .venv/bin/activate && pip-audit -r constraints.txt --no-deps --progress-spinner off
	cd frontend && npm audit --package-lock-only

release-check:
	bash scripts/release_check.sh

# Flatpak
FLATPAK_MANIFEST := io.github.cortega26.DNSpect.yaml
FLATPAK_BUILDDIR := build-flatpak
FLATPAK_PIP_GENERATOR ?= flatpak-pip-generator
FLATPAK_NODE_GENERATOR ?= flatpak-node-generator
FLATPAK_BUILDER ?= flatpak-builder
FLATPAK_BUILDER_LINT ?= flatpak-builder-lint

# Wheels must be preferred for the distributions that ship compiled extensions,
# otherwise the generator resolves an sdist and needs a Rust/C toolchain that the
# Sdk does not provide. crypto/pylsqpack arrive transitively via aioquic.
FLATPAK_WHEEL_PREFER := pydantic-core,uvloop,httptools,watchfiles,cryptography,cffi,pylsqpack

# Release inputs: python3-requirements.json is generated from the pinned runtime
# closure, generated-sources.json from frontend/package-lock.json. Neither
# generated file is safe to hand-edit. `make flatpak-consistency` verifies both.
flatpak-python-deps:
	$(FLATPAK_PIP_GENERATOR) --runtime=org.freedesktop.Sdk//25.08 \
		--requirements-file=packaging/flatpak/requirements.closure.txt \
		--wheel-arches=x86_64,aarch64 \
		--prefer-wheels=$(FLATPAK_WHEEL_PREFER) \
		--output=packaging/flatpak/python3-requirements.json

# Derive the fully pinned runtime closure from backend/constraints.txt so the
# generator cannot float transitive dependencies to whatever PyPI serves today.
packaging/flatpak/requirements.closure.txt: packaging/flatpak/requirements.txt backend/constraints.txt scripts/flatpak_python_closure.py
	python3 scripts/flatpak_python_closure.py > $@

flatpak-deps:
	cd frontend && $(FLATPAK_NODE_GENERATOR) npm --stub-requests package-lock.json -o ../packaging/flatpak/generated-sources.json

# Offline gate: version contract, manifest pin, app-id parity, metainfo
# releases, node sources against the pinned lockfile, python sources against the
# constraints closure, and manifest asset installs. Runs without flatpak-builder.
flatpak-consistency:
	python3 scripts/flatpak_consistency.py

flatpak-build:
	$(FLATPAK_BUILDER) --force-clean --repo=$(FLATPAK_BUILDDIR)/repo $(FLATPAK_BUILDDIR)/build $(FLATPAK_MANIFEST)

flatpak-validate: flatpak-consistency flatpak-build
	$(FLATPAK_BUILDER_LINT) manifest $(FLATPAK_MANIFEST)
	# --exceptions: pre-submission builds hit the registered
	# appstream-external-screenshot-url exception (screenshots are mirrored
	# by Flathub after submission); real errors are not suppressed.
	$(FLATPAK_BUILDER_LINT) --exceptions builddir $(FLATPAK_BUILDDIR)/build

flatpak-install:
	flatpak-builder --user --install --force-clean $(FLATPAK_BUILDDIR)/build $(FLATPAK_MANIFEST)

plans-archive:
	python3 scripts/archive_plans.py

.PHONY: flatpak-deps flatpak-python-deps flatpak-consistency flatpak-build flatpak-validate flatpak-install plans-archive
