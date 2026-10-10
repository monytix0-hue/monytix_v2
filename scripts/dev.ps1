$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}

docker compose up -d

Write-Host "API http://localhost:3000/platform/health"
Write-Host "Intelligence is internal to the compose network and is not published"
Write-Host "Postgres localhost:5432"
