#!/usr/bin/env bash
set -euo pipefail

BIN_PATH="${1:-release-assets/dnspect-linux-x64}"
BACKEND_HOST="${DNS_SPEED_LAB_HOST:-127.0.0.1}"
BACKEND_PORT="${DNS_SPEED_LAB_PORT:-18080}"
START_TIMEOUT_SECONDS="${DNSPECT_SMOKE_START_TIMEOUT_SECONDS:-15}"
HELP_TIMEOUT_SECONDS="${DNSPECT_SMOKE_HELP_TIMEOUT_SECONDS:-2}"

choose_python() {
  if [[ -n "${DNSPECT_SMOKE_PYTHON_BIN:-}" ]]; then
    echo "$DNSPECT_SMOKE_PYTHON_BIN"
    return
  fi
  if command -v python >/dev/null 2>&1 && python -c "import sys" >/dev/null 2>&1; then
    echo "python"
    return
  fi
  if command -v python3 >/dev/null 2>&1 && python3 -c "import sys" >/dev/null 2>&1; then
    echo "python3"
    return
  fi
  echo ""
}

PYTHON_CMD="$(choose_python)"

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Smoke fail: packaged binary not found at $BIN_PATH" >&2
  exit 1
fi

if [[ ! -x "$BIN_PATH" ]]; then
  chmod +x "$BIN_PATH"
fi

if [[ -z "$PYTHON_CMD" ]]; then
  echo "Smoke fail: Python interpreter not found (need python or python3)." >&2
  exit 1
fi

TMP_BASE="${TMPDIR:-/tmp}"
LOG_FILE="$(mktemp "${TMP_BASE}/dnspect-smoke-log.XXXXXX")"
HEALTH_FILE="$(mktemp "${TMP_BASE}/dnspect-smoke-health.XXXXXX")"
HELP_LOG_FILE="$(mktemp "${TMP_BASE}/dnspect-smoke-help.XXXXXX")"
BACK_PID=""

cleanup() {
  if [[ -n "$BACK_PID" ]] && kill -0 "$BACK_PID" 2>/dev/null; then
    kill "$BACK_PID" 2>/dev/null || true
    wait "$BACK_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE" "$HEALTH_FILE" "$HELP_LOG_FILE"
}
trap cleanup EXIT INT TERM

"$BIN_PATH" --help >"$HELP_LOG_FILE" 2>&1 &
HELP_PID=$!
help_deadline=$((SECONDS + HELP_TIMEOUT_SECONDS))
while kill -0 "$HELP_PID" 2>/dev/null; do
  if (( SECONDS >= help_deadline )); then
    kill "$HELP_PID" 2>/dev/null || true
    wait "$HELP_PID" 2>/dev/null || true
    break
  fi
  sleep 0.1
done

if [[ -s "$HELP_LOG_FILE" ]] && grep -Eiq 'usage|options|--help' "$HELP_LOG_FILE"; then
  echo "Packaged artifact smoke test OK via --help: $BIN_PATH"
  exit 0
fi

DNS_SPEED_LAB_GUI=headless DNS_SPEED_LAB_HOST="$BACKEND_HOST" DNS_SPEED_LAB_PORT="$BACKEND_PORT" "$BIN_PATH" >"$LOG_FILE" 2>&1 &
BACK_PID=$!

HEALTH_URL="http://${BACKEND_HOST}:${BACKEND_PORT}/api/health"
deadline=$((SECONDS + START_TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  if curl -fsS "$HEALTH_URL" >"$HEALTH_FILE" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$BACK_PID" 2>/dev/null; then
    echo "Smoke fail: packaged process exited before health endpoint was ready." >&2
    sed -n '1,200p' "$LOG_FILE" >&2
    exit 1
  fi
  sleep 0.5
done

if (( SECONDS >= deadline )); then
  echo "Smoke fail: timed out waiting for ${HEALTH_URL}" >&2
  sed -n '1,200p' "$LOG_FILE" >&2
  exit 1
fi

HEALTH_STATUS="$("$PYTHON_CMD" - "$HEALTH_FILE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
payload = json.loads(path.read_text(encoding="utf-8"))
print(payload.get("status", ""))
PY
)"
if [[ "$HEALTH_STATUS" != "ok" ]]; then
  echo "Smoke fail: /api/health returned status '$HEALTH_STATUS' (expected 'ok')." >&2
  sed -n '1,200p' "$LOG_FILE" >&2
  exit 1
fi

if ! grep -q "Uvicorn running on http://" "$LOG_FILE"; then
  echo "Smoke fail: expected startup log not found in packaged binary output." >&2
  sed -n '1,200p' "$LOG_FILE" >&2
  exit 1
fi

kill "$BACK_PID" 2>/dev/null || true
wait "$BACK_PID" 2>/dev/null || true
BACK_PID=""

echo "Packaged artifact smoke test OK: $BIN_PATH"
