$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }
$backendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8001" }

Set-Location "$root\backend"
if (-not (Test-Path ".venv")) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3.11 -m venv .venv
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    python -m venv .venv
  } else {
    throw "No se encontró Python en el sistema."
  }
}

.\.venv\Scripts\Activate.ps1
python -m ensurepip --upgrade | Out-Null
python -m pip install -c constraints.txt -e .[dev] | Out-Null

$backendProc = Start-Process -PassThru powershell -ArgumentList "-NoProfile", "-Command", "cd '$root\backend'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --host $backendHost --port $backendPort"

try {
  Start-Sleep -Seconds 2
  $health = Invoke-RestMethod -Uri "http://$backendHost`:$backendPort/api/health"
  if ($health.status -ne "ok") {
    throw "Smoke fail: /api/health no devolvió ok"
  }

  $payload = @{
    runs = 2
    timeout_sec = 1
    resolvers = @("1.1.1.1")
    queries = @("example.com")
    mode = "quick"
  } | ConvertTo-Json

  $start = Invoke-RestMethod -Uri "http://$backendHost`:$backendPort/api/benchmarks" -Method Post -ContentType "application/json" -Body $payload
  $benchmarkId = $start.benchmark_id

  $deadline = (Get-Date).AddSeconds(20)
  while ($true) {
    $status = Invoke-RestMethod -Uri "http://$backendHost`:$backendPort/api/benchmarks/$benchmarkId"
    if ($status.status -eq "done") { break }
    if ($status.status -eq "failed" -or $status.status -eq "cancelled") { throw "Smoke fail: benchmark en error" }
    if ((Get-Date) -gt $deadline) { throw "Smoke fail: timeout esperando benchmark" }
    Start-Sleep -Milliseconds 500
  }

  $csvResp = Invoke-WebRequest -Uri "http://$backendHost`:$backendPort/api/benchmarks/$benchmarkId/export.csv" -OutFile "$env:TEMP\dnspect-smoke.csv"
  $jsonResp = Invoke-WebRequest -Uri "http://$backendHost`:$backendPort/api/benchmarks/$benchmarkId/export.json" -OutFile "$env:TEMP\dnspect-smoke.json"

  if ($csvResp.StatusCode -ne 200 -or $jsonResp.StatusCode -ne 200) {
    throw "Smoke fail: export.csv=$($csvResp.StatusCode), export.json=$($jsonResp.StatusCode)"
  }

  Write-Host "Smoke test OK (benchmark_id=$benchmarkId)"
}
finally {
  if ($backendProc -and -not $backendProc.HasExited) {
    Stop-Process -Id $backendProc.Id -Force
  }
}
