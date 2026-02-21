.PHONY: backend-install backend-dev backend-check frontend-install frontend-dev frontend-check dev smoke

backend-install:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

backend-dev:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload

backend-check:
	cd backend && . .venv/bin/activate && ruff check . && ruff format --check . && mypy && pytest -q

frontend-install:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

frontend-check:
	cd frontend && npm run lint && npm run typecheck && npm run build

dev:
	bash scripts/dev.sh

smoke:
	bash scripts/smoke_test.sh
