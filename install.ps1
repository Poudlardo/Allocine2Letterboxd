# Allocine2Letterboxd - Installeur Windows
# Usage: irm https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO = "Poudlardo/Allocine2Letterboxd"
$BINARY_NAME = "allocine2letterboxd.exe"

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERREUR] $msg" -ForegroundColor Red; exit 1 }

# Demande de l'URL
$ALLOCINE_URL = Read-Host "  Entrez l'URL de votre profil Allocine"

# Validation de l'URL
if ($ALLOCINE_URL -notmatch '^https://www\.allocine\.fr/membre-[A-Z0-9]') {
    Write-Host ""
    Write-Err "URL Allocine invalide ! Veuillez fournir une URL comme : https://www.allocine.fr/membre-Z20060328181626557554912/films/"
}

Write-Host ""

# Téléchargement du dernier release
Write-Step "Téléchargement du dernier release..."
$apiUrl = "https://api.github.com/repos/$REPO/releases/latest"
try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "allocine2letterboxd-installer" }
} catch {
    Write-Err "Échec de la récupération du dernier release : $_"
}

$asset = $release.assets | Where-Object { $_.name -eq $BINARY_NAME } | Select-Object -First 1
if (-not $asset) {
    Write-Err "Aucun binaire Windows trouvé dans le dernier release. Attendu : $BINARY_NAME"
}

$downloadUrl = $asset.browser_download_url
$tempExe = Join-Path $env:TEMP $BINARY_NAME

try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempExe -UseBasicParsing
} catch {
    Write-Err "Échec du téléchargement du binaire : $_"
}
Write-Ok "Binaire téléchargé"

# Lancement du scraping
Write-Host ""
Write-Host "[*] Démarrage du scraping..." -ForegroundColor Cyan
Write-Host ""
& $tempExe $ALLOCINE_URL

# Nettoyage
Remove-Item $tempExe -ErrorAction SilentlyContinue

Write-Host ""
Write-Ok "Terminé !"
Write-Host ""
Write-Host "Prochaines étapes :"
Write-Host "  Importer vers Letterboxd :"
Write-Host "    - allocine-films*.csv -> https://letterboxd.com/import/"
Write-Host "    - allocine-films-a-voir.csv -> https://letterboxd.com/watchlist/"
Write-Host ""
