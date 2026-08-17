if (-not (Test-Path "package.json")) {
    Write-Host "Run this from inside the nexus621 folder." -ForegroundColor Red
    exit 1
}

if (Test-Path "patched\main.js") {
    Write-Host "Applying patched main.js..." -ForegroundColor Cyan
    Copy-Item "patched\main.js" "electron\main.js" -Force
} else {
    Write-Host "No patched\main.js found - skipping patch, using existing file." -ForegroundColor Yellow
}

Write-Host "Clearing Vite dependency cache..." -ForegroundColor Cyan
Remove-Item -Recurse -Force "node_modules\.vite" -ErrorAction SilentlyContinue

Write-Host "Launching Nexus RGB OS (dev)..." -ForegroundColor Cyan
npm run electron:dev
