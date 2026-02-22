#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8001}"

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
  if [[ -n "${BACK_PID:-}" ]]; then
    kill "$BACK_PID" 2>/dev/null || true
    wait "$BACK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$ROOT_DIR/backend"
if [[ ! -d .venv ]]; then
  "$PYTHON_CMD" -m venv .venv
fi
source .venv/bin/activate
python -m pip install -c constraints.txt -e .[dev] >/dev/null
uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" >/tmp/dns-speed-lab-smoke.log 2>&1 &
BACK_PID=$!

sleep 1
HEALTH=$(curl -fsS "http://${BACKEND_HOST}:${BACKEND_PORT}/api/health")
STATUS=$(echo "$HEALTH" | python -c 'import json,sys; print(json.load(sys.stdin)["status"])')
if [[ "$STATUS" != "ok" ]]; then
  echo "Smoke fail: /api/health no devolvió ok"
  exit 1
fi

START=$(curl -fsS -X POST "http://${BACKEND_HOST}:${BACKEND_PORT}/api/benchmarks" -H 'Content-Type: application/json' -d '{"runs":2,"timeout_sec":1,"resolvers":["1.1.1.1"],"queries":["example.com"],"mode":"quick"}')
BID=$(echo "$START" | python -c 'import json,sys; print(json.load(sys.stdin)["benchmark_id"])')

deadline=$((SECONDS + 20))
while true; do
  RESP=$(curl -fsS "http://${BACKEND_HOST}:${BACKEND_PORT}/api/benchmarks/$BID")
  STATE=$(echo "$RESP" | python -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  if [[ "$STATE" == "done" ]]; then
    break
  fi
  if [[ "$STATE" == "failed" || "$STATE" == "cancelled" ]]; then
    echo "Smoke fail: benchmark terminó en error"
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "Smoke fail: timeout esperando benchmark"
    exit 1
  fi
  sleep 0.5
done

CSV_CODE=$(curl -s -o /tmp/dns-speed-lab-smoke.csv -w '%{http_code}' "http://${BACKEND_HOST}:${BACKEND_PORT}/api/benchmarks/$BID/export.csv")
JSON_CODE=$(curl -s -o /tmp/dns-speed-lab-smoke.json -w '%{http_code}' "http://${BACKEND_HOST}:${BACKEND_PORT}/api/benchmarks/$BID/export.json")

if [[ "$CSV_CODE" != "200" || "$JSON_CODE" != "200" ]]; then
  echo "Smoke fail: export.csv=$CSV_CODE export.json=$JSON_CODE"
  exit 1
fi

echo "Smoke test OK (benchmark_id=$BID)"
