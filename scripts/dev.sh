#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

choose_python() {
  if [[ -n "${PYTHON_BIN:-}" ]]; then
    echo "$PYTHON_BIN"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return
  fi
  if command -v python >/dev/null 2>&1; then
    echo "python"
    return
  fi
  echo "No se encontró Python (python3/python)." >&2
  exit 1
}

PYTHON_CMD="$(choose_python)"
if ! "$PYTHON_CMD" -m pip --version >/dev/null 2>&1; then
  "$PYTHON_CMD" -m ensurepip --upgrade >/dev/null 2>&1 || true
fi
if ! "$PYTHON_CMD" -m pip --version >/dev/null 2>&1; then
  echo "No se pudo inicializar pip con $PYTHON_CMD. Usa PYTHON_BIN con un Python válido." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${BACK_PID:-}" ]]; then kill "$BACK_PID" 2>/dev/null || true; fi
  if [[ -n "${FRONT_PID:-}" ]]; then kill "$FRONT_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

cd "$ROOT_DIR/backend"
if [[ ! -d .venv ]]; then
  "$PYTHON_CMD" -m venv .venv
fi
source .venv/bin/activate
python -m pip install -e .[dev] >/dev/null
uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACK_PID=$!

deactivate
cd "$ROOT_DIR/frontend"
if [[ ! -d node_modules ]]; then
  npm ci >/dev/null
fi
VITE_API_BASE="http://${BACKEND_HOST}:${BACKEND_PORT}" npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
FRONT_PID=$!

wait
