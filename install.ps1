#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Allocine2Letterboxd - Installateur Windows" -ForegroundColor White
Write-Host "  ============================================" -ForegroundColor White

$REPO_URL    = "https://github.com/Poudlardo/Allocine2Letterboxd.git"
$INSTALL_DIR = Join-Path $env:USERPROFILE "Allocine2Letterboxd"

# ── Recharger le PATH depuis le registre ──────────────────────────────────────
function Refresh-Path {
    $machine = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    $user    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH = "$machine;$user"
}

# ── Winget ────────────────────────────────────────────────────────────────────
Write-Step "Verification de winget"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Warn "winget introuvable - ouverture du Microsoft Store pour App Installer..."
    Start-Process "ms-windows-store://pdp/?productid=9NBLGGH4NNS1"
    Write-Host "  Installez 'App Installer' puis relancez ce script." -ForegroundColor Yellow
    exit 0
}
Write-Ok "winget disponible"

# ── Git ───────────────────────────────────────────────────────────────────────
Write-Step "Verification de Git"
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Ok "Git deja installe - $(git --version)"
} else {
    Write-Warn "Git introuvable, installation via winget..."
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Warn "Redemarrez PowerShell si git n'est pas reconnu, puis relancez le script."
        exit 0
    }
    Write-Ok "Git installe - $(git --version)"
}

# ── Node.js ───────────────────────────────────────────────────────────────────
Write-Step "Verification de Node.js"
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Ok "Node.js deja installe - $(node --version)"
} else {
    Write-Warn "Node.js introuvable, installation via winget..."
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn "Redemarrez PowerShell si node n'est pas reconnu, puis relancez le script."
        exit 0
    }
    Write-Ok "Node.js installe - $(node --version)"
}

# ── Depot ─────────────────────────────────────────────────────────────────────
Write-Step "Recuperation du projet"
if (Test-Path (Join-Path $INSTALL_DIR ".git")) {
    Write-Warn "Dossier deja present, mise a jour..."
    git -C $INSTALL_DIR pull --ff-only
    Write-Ok "Projet mis a jour"
} else {
    git clone $REPO_URL $INSTALL_DIR
    Write-Ok "Projet clone dans $INSTALL_DIR"
}

# ── Dependances npm ───────────────────────────────────────────────────────────
Write-Step "Installation des dependances"
Set-Location $INSTALL_DIR
npm install --silent
Write-Ok "Dependances installees"

# ── Lancement ─────────────────────────────────────────────────────────────────
Write-Host "`n  Tout est pret ! Lancement...`n" -ForegroundColor White
node index.js
