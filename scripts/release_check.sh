#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${RELEASE_CHECK_PORT:-8123}"
START_TIMEOUT_SECONDS="${RELEASE_CHECK_START_TIMEOUT_SECONDS:-30}"
VENV_PYTHON="$ROOT_DIR/backend/.venv/bin/python"
BIN_PATH="$ROOT_DIR/dist/dnspect-linux"

cd "$ROOT_DIR"

step() {
  echo "==> $*"
}

# 1. Version contract: all three version sources must agree.
step "1/5 version contract"
VERSION_CONTRACT_OUTPUT="$(python3 -c 'import json, tomllib; from pathlib import Path; versions={tomllib.loads(Path("backend/pyproject.toml").read_text())["project"]["version"], Path("backend/app/__init__.py").read_text().split("\"")[1], json.loads(Path("frontend/package.json").read_text())["version"]}; assert len(versions) == 1, versions; print("version-contract-ok:" + versions.pop())')"
VERSION="${VERSION_CONTRACT_OUTPUT#version-contract-ok:}"
if [[ -z "$VERSION" || "$VERSION" == "$VERSION_CONTRACT_OUTPUT" ]]; then
  echo "release-check fail: unexpected version contract output: $VERSION_CONTRACT_OUTPUT" >&2
  exit 1
fi
step "version contract ok: $VERSION"

# 2. Backend gate (ruff, format, mypy, bandit, pytest).
step "2/5 backend-check"
make backend-check

# 3. Frontend gate (lint, typecheck, build, test).
step "3/5 frontend gate"
(
  cd "$ROOT_DIR/frontend"
  npm run lint
  npm run typecheck
  npm run build
  npm test
)

# 4. Dev-mode smoke test (spins its own backend on port 8001).
step "4/5 smoke test"
bash "$ROOT_DIR/scripts/smoke_test.sh"

# 5. Packaged build + assertions.
step "5/5 packaged build and smoke"
if ! "$VENV_PYTHON" -c "import PyInstaller" >/dev/null 2>&1; then
  step "installing backend pack extra (PyInstaller)"
  "$VENV_PYTHON" -m pip install -q -c "$ROOT_DIR/backend/constraints.txt" -e "$ROOT_DIR/backend[pack]"
fi
"$VENV_PYTHON" "$ROOT_DIR/scripts/package_backend.py"
if [[ ! -f "$BIN_PATH" ]]; then
  echo "release-check fail: packaged binary not found at $BIN_PATH" >&2
  exit 1
fi
if [[ ! -x "$BIN_PATH" ]]; then
  chmod +x "$BIN_PATH"
fi

TMP_BASE="${TMPDIR:-/tmp}"
LOG_FILE="$(mktemp "${TMP_BASE}/release-check-server-log.XXXXXX")"
HEALTH_FILE="$(mktemp "${TMP_BASE}/release-check-health.XXXXXX")"
BACK_PID=""

cleanup() {
  if [[ -n "$BACK_PID" ]] && kill -0 "$BACK_PID" 2>/dev/null; then
    kill "$BACK_PID" 2>/dev/null || true
    wait "$BACK_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE" "$HEALTH_FILE"
}
trap cleanup EXIT INT TERM

DNS_SPEED_LAB_GUI=headless DNS_SPEED_LAB_HOST=127.0.0.1 DNS_SPEED_LAB_PORT="$BACKEND_PORT" "$BIN_PATH" >"$LOG_FILE" 2>&1 &
BACK_PID=$!

HEALTH_URL="http://127.0.0.1:${BACKEND_PORT}/api/health"
deadline=$((SECONDS + START_TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  if curl -fsS "$HEALTH_URL" >"$HEALTH_FILE" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$BACK_PID" 2>/dev/null; then
    echo "release-check fail: packaged process exited before the health endpoint was ready." >&2
    sed -n '1,200p' "$LOG_FILE" >&2
    exit 1
  fi
  sleep 0.5
done

if (( SECONDS >= deadline )); then
  echo "release-check fail: timed out waiting for ${HEALTH_URL}" >&2
  sed -n '1,200p' "$LOG_FILE" >&2
  exit 1
fi

# Assert version parity and that DoQ is bundled in the packaged binary.
"$VENV_PYTHON" - "$HEALTH_FILE" "$VERSION" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
expected = sys.argv[2]
reported = payload.get("version")
if reported != expected:
    print(f"release-check fail: packaged version {reported!r} != {expected!r}", file=sys.stderr)
    sys.exit(1)
if payload.get("capabilities", {}).get("doq") is not True:
    print(f"release-check fail: packaged binary reports doq:{payload.get('capabilities', {}).get('doq')!r} (DoQ must be bundled)", file=sys.stderr)
    sys.exit(1)
print(f"packaged health ok: version={reported} doq=true")
PY

ROOT_STATUS="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${BACKEND_PORT}/")"
if [[ "$ROOT_STATUS" != "200" ]]; then
  echo "release-check fail: root route returned HTTP $ROOT_STATUS (expected 200)" >&2
  exit 1
fi

kill "$BACK_PID" 2>/dev/null || true
wait "$BACK_PID" 2>/dev/null || true
BACK_PID=""

echo "release-check: PASS ($VERSION)"
