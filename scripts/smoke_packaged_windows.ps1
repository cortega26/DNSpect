param(
  [string]$BinaryPath = "release-assets\dnspect-windows-x64.exe",
  [string]$Port = "18080",
  [int]$StartupTimeoutSec = 15
)

$ErrorActionPreference = "Stop"

$exe = Resolve-Path $BinaryPath -ErrorAction Stop
if (-not (Test-Path $exe)) {
  throw "Executable not found: $exe"
}

$logOut = Join-Path $env:TEMP "dnspect-packaged-smoke-out.log"
$logErr = Join-Path $env:TEMP "dnspect-packaged-smoke-err.log"

$prevGui = $env:DNS_SPEED_LAB_GUI
$prevHost = $env:DNS_SPEED_LAB_HOST
$prevPort = $env:DNS_SPEED_LAB_PORT

$env:DNS_SPEED_LAB_GUI = "headless"
$env:DNS_SPEED_LAB_HOST = "127.0.0.1"
$env:DNS_SPEED_LAB_PORT = $Port

$healthUrl = "http://127.0.0.1:$Port/api/health"
$rootUrl = "http://127.0.0.1:$Port/"

try {
  $proc = Start-Process -PassThru -FilePath $exe -NoNewWindow `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr

  $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
      $stdout = Get-Content -Raw $logOut -ErrorAction SilentlyContinue
      $stderr = Get-Content -Raw $logErr -ErrorAction SilentlyContinue
      throw "Process exited early (exit code: $($proc.ExitCode)).`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
    }
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($health.status -eq "ok") {
        $healthy = $true
        break
      }
    } catch {}
    Start-Sleep -Milliseconds 250
  }

  if (-not $healthy) {
    $stdout = Get-Content -Raw $logOut -ErrorAction SilentlyContinue
    throw "Health endpoint did not respond within ${StartupTimeoutSec}s.`nSTDOUT:`n$stdout"
  }

  $root = Invoke-WebRequest -Uri $rootUrl -TimeoutSec 5
  if ($root.StatusCode -ne 200) {
    throw "Root page returned HTTP $($root.StatusCode)"
  }
  if ($root.Content -notmatch "<html") {
    throw "Root page does not contain HTML"
  }

  $startupFound = $false
  while ((Get-Date) -lt $deadline) {
    $startupLog = Get-Content -Raw $logOut -ErrorAction SilentlyContinue
    if ($startupLog -match "DNSpect server running on http://") {
      $startupFound = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $startupFound) {
    $startupErr = Get-Content -Raw $logErr -ErrorAction SilentlyContinue
    throw "Startup message not found in log.`nSTDOUT:`n$startupLog`nSTDERR:`n$startupErr"
  }

  Write-Host "Packaged Windows artifact smoke test OK"
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $proc.WaitForExit(3000) | Out-Null
  }

  if ($prevGui) { $env:DNS_SPEED_LAB_GUI = $prevGui } else { Remove-Item Env:\DNS_SPEED_LAB_GUI -ErrorAction SilentlyContinue }
  if ($prevHost) { $env:DNS_SPEED_LAB_HOST = $prevHost } else { Remove-Item Env:\DNS_SPEED_LAB_HOST -ErrorAction SilentlyContinue }
  if ($prevPort) { $env:DNS_SPEED_LAB_PORT = $prevPort } else { Remove-Item Env:\DNS_SPEED_LAB_PORT -ErrorAction SilentlyContinue }

  Remove-Item $logOut, $logErr -ErrorAction SilentlyContinue
}
