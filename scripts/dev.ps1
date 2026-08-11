$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }
$backendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$frontendHost = if ($env:FRONTEND_HOST) { $env:FRONTEND_HOST } else { "127.0.0.1" }
$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }

Set-Location "$root\backend"
if (-not (Test-Path ".venv")) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3.13 -m venv .venv
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    python -m venv .venv
  } else {
    throw "No se encontró Python en el sistema."
  }
}

.\.venv\Scripts\Activate.ps1
$pyVer = & .\.venv\Scripts\python.exe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ([version]$pyVer -lt [version]"3.13") {
  throw "Python del venv es $pyVer, se requiere >=3.13. Elimina backend/.venv y recrea con Python 3.13."
}
python -m ensurepip --upgrade | Out-Null
python -m pip install -r constraints.txt -e .[dev] | Out-Null
$backendProc = Start-Process -PassThru -NoNewWindow powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host $backendHost --port $backendPort"

Set-Location "$root\frontend"
if (-not (Test-Path "node_modules")) {
  npm ci | Out-Null
}
$env:VITE_API_BASE = "http://$backendHost`:$backendPort"
try {
  npm run dev -- --host $frontendHost --port $frontendPort
} finally {
  if ($backendProc -and -not $backendProc.HasExited) {
    Stop-Process -Id $backendProc.Id -Force
  }
}
