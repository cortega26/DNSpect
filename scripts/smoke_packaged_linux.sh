#!/usr/bin/env bash
set -euo pipefail

BIN_PATH="${1:-release-assets/dnspect-linux-x64}"
BACKEND_HOST="${DNS_SPEED_LAB_HOST:-127.0.0.1}"
BACKEND_PORT="${DNS_SPEED_LAB_PORT:-18080}"
START_TIMEOUT_SECONDS="${DNSPECT_SMOKE_START_TIMEOUT_SECONDS:-15}"

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Smoke fail: packaged binary not found at $BIN_PATH" >&2
  exit 1
fi

if [[ ! -x "$BIN_PATH" ]]; then
  chmod +x "$BIN_PATH"
fi

LOG_FILE="$(mktemp -t dnspect-linux-smoke-log.XXXXXX)"
HEALTH_FILE="$(mktemp -t dnspect-linux-smoke-health.XXXXXX)"
BACK_PID=""

cleanup() {
  if [[ -n "$BACK_PID" ]] && kill -0 "$BACK_PID" 2>/dev/null; then
    kill "$BACK_PID" 2>/dev/null || true
    wait "$BACK_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE" "$HEALTH_FILE"
}
trap cleanup EXIT INT TERM

DNS_SPEED_LAB_OPEN_BROWSER=0 DNS_SPEED_LAB_HOST="$BACKEND_HOST" DNS_SPEED_LAB_PORT="$BACKEND_PORT" "$BIN_PATH" >"$LOG_FILE" 2>&1 &
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

HEALTH_STATUS="$(python - "$HEALTH_FILE" <<'PY'
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

echo "Packaged Linux smoke test OK: $BIN_PATH"
