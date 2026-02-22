.PHONY: backend-install backend-dev backend-check backend-semgrep frontend-install frontend-dev frontend-check dev smoke

backend-install:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

backend-dev:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload

backend-check:
	cd backend && . .venv/bin/activate && ruff check . && ruff format --check . && black --check . && mypy && bandit -q -c pyproject.toml -r app && pytest -q

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
