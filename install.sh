#!/usr/bin/env bash
set -euo pipefail

# ── Couleurs ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

step() { echo -e "\n${BLUE}==>${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "  ${RED}✗${NC} $1" >&2; exit 1; }

echo -e "\n${BOLD}  🎬  Allocine2Letterboxd — Installateur${NC}"
echo    "  ════════════════════════════════════════"

OS="$(uname -s)"
REPO_URL="https://github.com/Poudlardo/Allocine2Letterboxd.git"
INSTALL_DIR="$HOME/Allocine2Letterboxd"

# ── Charger nvm si disponible ──────────────────────────────────────────────────
load_nvm() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && source "$NVM_DIR/bash_completion"
}
load_nvm

# ── Git ────────────────────────────────────────────────────────────────────────
step "Vérification de Git"
if command -v git &>/dev/null; then
    ok "Git déjà installé — $(git --version)"
else
    warn "Git introuvable, installation en cours..."
    case "$OS" in
        Darwin)
            if command -v brew &>/dev/null; then
                brew install git
            else
                warn "Homebrew absent — installation des Xcode Command Line Tools"
                xcode-select --install 2>/dev/null || true
                echo "  → Relancez ce script une fois git disponible."
                exit 0
            fi ;;
        Linux)
            if   command -v apt-get &>/dev/null; then sudo apt-get update -qq && sudo apt-get install -y git
            elif command -v dnf     &>/dev/null; then sudo dnf install -y git
            elif command -v pacman  &>/dev/null; then sudo pacman -S --noconfirm git
            elif command -v zypper  &>/dev/null; then sudo zypper install -y git
            else err "Gestionnaire de paquets non reconnu. Installez git manuellement."; fi ;;
        *)
            err "Système non supporté : $OS" ;;
    esac
    ok "Git installé — $(git --version)"
fi

# ── Node.js ────────────────────────────────────────────────────────────────────
step "Vérification de Node.js"
if command -v node &>/dev/null; then
    ok "Node.js déjà installé — $(node --version)"
else
    NVM_VERSION="v0.40.3"

    if command -v nvm &>/dev/null 2>&1; then
        warn "Node.js absent, installation via nvm (LTS)..."
    else
        warn "nvm introuvable, installation de nvm $NVM_VERSION..."
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
        load_nvm
    fi

    nvm install --lts
    nvm use --lts
    ok "Node.js installé — $(node --version)"
fi

# ── Dépôt ─────────────────────────────────────────────────────────────────────
step "Récupération du projet"
if [ -d "$INSTALL_DIR/.git" ]; then
    warn "Dossier déjà présent, mise à jour..."
    git -C "$INSTALL_DIR" pull --ff-only
    ok "Projet mis à jour"
else
    git clone "$REPO_URL" "$INSTALL_DIR"
    ok "Projet cloné dans $INSTALL_DIR"
fi

# ── Dépendances npm ────────────────────────────────────────────────────────────
step "Installation des dépendances"
cd "$INSTALL_DIR"
load_nvm   # rechargement au cas où node vient d'être installé
npm install --silent
ok "Dépendances installées"

# ── Lancement ──────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}  Tout est prêt ! Lancement...${NC}\n"
node index.js
