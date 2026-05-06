#!/usr/bin/env bash
# NE PAS ajouter set -euo pipefail : ce script s'exécute via curl | bash
# et la moindre commande qui échoue tuerait le processus silencieusement.

# ── Helpers ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

step() { printf "\n${BLUE}==> ${BOLD}%s${NC}\n" "$1"; }
ok()   { printf "  ${GREEN}OK${NC}  %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${NC}   %s\n" "$1"; }
die()  { printf "  ${RED}ERR${NC} %s\n" "$1" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

printf "\n${BOLD}  Allocine2Letterboxd — Installateur${NC}\n"
printf "  ======================================\n\n"

OS="$(uname -s 2>/dev/null || printf 'unknown')"
REPO_URL="https://github.com/Poudlardo/Allocine2Letterboxd.git"
REPO_BRANCH="main"
INSTALL_DIR="${HOME}/Allocine2Letterboxd"
NVM_VERSION="v0.40.3"
NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
export NVM_DIR

# Charge nvm dans le shell courant
load_nvm() {
    # shellcheck source=/dev/null
    [ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"
}
load_nvm

# ── Git ────────────────────────────────────────────────────────────────────────
step "Vérification de Git"
if has git; then
    ok "Git déjà installé — $(git --version)"
else
    warn "Git introuvable, installation en cours..."
    case "$OS" in
        Darwin)
            if has brew; then
                brew install git || die "Installation de git via brew échouée"
            else
                warn "Homebrew absent — lancement de xcode-select --install"
                xcode-select --install 2>/dev/null || true
                printf "  → Relancez ce script une fois git installé.\n"
                exit 0
            fi ;;
        Linux)
            if has apt-get; then
                sudo apt-get update -qq \
                    && sudo apt-get install -y --no-install-recommends git curl \
                    || die "Installation de git via apt-get échouée"
            elif has dnf; then
                sudo dnf install -y git curl || die "Installation de git via dnf échouée"
            elif has pacman; then
                sudo pacman -S --noconfirm git curl || die "Installation de git via pacman échouée"
            elif has zypper; then
                sudo zypper install -y git curl || die "Installation de git via zypper échouée"
            else
                die "Gestionnaire de paquets non reconnu. Installez git manuellement puis relancez."
            fi ;;
        *)
            die "Système non supporté : $OS" ;;
    esac
    has git || die "Git toujours introuvable après installation."
    ok "Git installé — $(git --version)"
fi

# ── Node.js via nvm (sans sudo, installation locale) ──────────────────────────
step "Vérification de Node.js"
if has node; then
    ok "Node.js déjà installé — $(node --version)"
else
    if ! has nvm; then
        warn "Installation de nvm ${NVM_VERSION} (sans sudo)..."
        # Téléchargement dans un fichier temporaire pour éviter le conflit stdin
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" \
            -o /tmp/_nvm_install.sh || die "Téléchargement de nvm échoué"
        bash /tmp/_nvm_install.sh || die "Installation de nvm échouée"
        rm -f /tmp/_nvm_install.sh
        load_nvm
    fi

    has nvm || die "nvm introuvable après installation. Relancez le script."

    warn "Installation de Node.js LTS via nvm..."
    nvm install --lts || die "Installation de Node.js échouée"
    nvm use --lts
    ok "Node.js installé — $(node --version)"
fi

# ── Dépendances système pour les navigateurs headless (Linux uniquement) ───────
if [ "$OS" = "Linux" ] && has apt-get; then
    step "Dépendances système (navigateurs headless)"
    # Ces librairies sont requises par Firefox et Chrome même en mode headless.
    # Ubuntu 24+ a renommé libasound2 en libasound2t64, on essaie les deux.
    sudo apt-get install -y --no-install-recommends \
        libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
        libgtk-3-0 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libpango-1.0-0 libcairo2 libnss3 libnspr4 \
        libdbus-glib-1-2 libx11-xcb1 libxss1 2>/dev/null || true
    # libasound2 renommé libasound2t64 sur Ubuntu 24.04+
    sudo apt-get install -y --no-install-recommends libasound2 2>/dev/null \
        || sudo apt-get install -y --no-install-recommends libasound2t64 2>/dev/null || true
    ok "Librairies système prêtes"
fi

# ── Dépôt ─────────────────────────────────────────────────────────────────────
step "Récupération du projet"
if [ -d "${INSTALL_DIR}/.git" ]; then
    warn "Dossier déjà présent, mise à jour..."
    git -C "${INSTALL_DIR}" pull --ff-only || warn "Mise à jour ignorée (conflits locaux ?)"
    ok "Projet mis à jour"
else
    git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}" \
        || die "Clonage du dépôt échoué"
    ok "Projet cloné dans ${INSTALL_DIR}"
fi

# ── Dépendances npm (locales, sans -g) ────────────────────────────────────────
step "Installation des dépendances"
cd "${INSTALL_DIR}" || die "Impossible d'accéder à ${INSTALL_DIR}"
load_nvm  # recharge node si fraîchement installé
npm install --silent || die "npm install échoué"
ok "Dépendances installées"

# ── Lancement ──────────────────────────────────────────────────────────────────
# Rediriger stdin depuis /dev/tty : quand le script est lu via curl|bash,
# stdin est occupé par le pipe et node ne peut pas lire la saisie utilisateur.
printf "\n${BOLD}  Tout est prêt ! Lancement...${NC}\n\n"
if [ -t 0 ]; then
    node index.js
else
    node index.js </dev/tty
fi
