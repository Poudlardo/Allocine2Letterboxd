# Allocine2Letterboxd - Rust Version Windows Installer
# Usage: irm https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/vibe/rust-version-a5b8bf/rust-version/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO = "Poudlardo/Allocine2Letterboxd"
$BINARY_NAME = "allocine2letterboxd.exe"

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

# Ask for URL
$ALLOCINE_URL = Read-Host "  Enter your Allocine profile URL"

# Validate URL
if ($ALLOCINE_URL -notmatch '^https://www\.allocine\.fr/membre-[A-Z0-9]') {
    Write-Host ""
    Write-Err "Invalid Allocine URL! Please provide a URL like: https://www.allocine.fr/membre-Z20060328181626557554912/films/"
}

Write-Host ""

# Download the latest release binary
Write-Step "Downloading latest release..."
$apiUrl = "https://api.github.com/repos/$REPO/releases/latest"
try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "allocine2letterboxd-installer" }
} catch {
    Write-Err "Failed to fetch latest release: $_"
}

$asset = $release.assets | Where-Object { $_.name -eq $BINARY_NAME } | Select-Object -First 1
if (-not $asset) {
    Write-Err "No Windows binary found in latest release. Expected asset: $BINARY_NAME"
}

$downloadUrl = $asset.browser_download_url
$tempExe = Join-Path $env:TEMP $BINARY_NAME

try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempExe -UseBasicParsing
} catch {
    Write-Err "Failed to download binary: $_"
}
Write-Ok "Binary downloaded"

# Run scraper
Write-Host ""
Write-Host "[*] Starting scrape..." -ForegroundColor Cyan
Write-Host ""
& $tempExe $ALLOCINE_URL

# Cleanup
Remove-Item $tempExe -ErrorAction SilentlyContinue

Write-Host ""
Write-Ok "All done!"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  Import to Letterboxd:"
Write-Host "    - allocine-films.csv -> https://letterboxd.com/import/"
Write-Host "    - allocine-films-a-voir.csv -> https://letterboxd.com/watchlist/"
Write-Host ""
