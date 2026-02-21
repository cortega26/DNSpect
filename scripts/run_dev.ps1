$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
& "$root\scripts\dev.ps1"
