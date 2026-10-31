Set-Location -Path $PSScriptRoot

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "                AddisGo - Addis Ababa City Guide" -ForegroundColor Green
Write-Host "     Electric Mobility, Verified Local Guides & Small-Group Tours" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor White
Write-Host ""

$nodeCmd = if (Test-Path "bin\node.exe") {
    Write-Host "[*] Using bundled portable Node.js engine" -ForegroundColor Yellow
    (Resolve-Path "bin\node.exe").Path
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "[*] Using system Node.js engine" -ForegroundColor Yellow
    "node"
} else {
    Write-Host "[ERROR] Node.js not found." -ForegroundColor Red
    Write-Host "Please install Node 22+ from https://nodejs.org" -ForegroundColor Red
    pause
    exit 1
}

# Auto-open browser after 2 seconds
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:3003"
} | Out-Null

Write-Host "[*] AddisGo is running at http://localhost:3003" -ForegroundColor Green
Write-Host "    Admin:   admin@addisgo.et / Admin123!" -ForegroundColor White
Write-Host "    Rider:   rider@addisgo.et / Rider123!" -ForegroundColor White
Write-Host "    Driver:  dawit@addisgo.et / Driver123!" -ForegroundColor White
Write-Host "    Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

& $nodeCmd "api\server.js"
