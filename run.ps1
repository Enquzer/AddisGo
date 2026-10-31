# AddisGo - one-command start (Windows PowerShell)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js 22.5 or newer is required. Install it from https://nodejs.org' -ForegroundColor Red
  exit 1
}

$version = (& node -p "process.versions.node").Trim()
$parts = $version.Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 5)) {
  Write-Host "Node $version found, but 22.5+ is required (Node 24 LTS recommended)." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path 'api\node_modules\qrcode-generator\package.json')) {
  Write-Host 'Installing API dependencies (only qrcode-generator)...' -ForegroundColor DarkGray
  $npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
  & $npm install --prefix api --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ''
Write-Host '  AddisGo - http://localhost:3003 (falls back to 3004-3010 if busy)' -ForegroundColor Green
Write-Host '  Demo admin: admin@addisgo.et / Admin123!'
Write-Host '  Press Ctrl+C to stop.'
Write-Host ''

node api/server.js
