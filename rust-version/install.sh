#!/bin/bash

# Allocine2Letterboxd - Version Rust
# Script d'installation universel compatible curl | bash

set -e

# Informations du dépôt
REPO_URL="https://github.com/Poudlardo/Allocine2Letterboxd.git"
BRANCH="vibe/rust-version-a5b8bf"
TEMP_DIR=""

# Nettoyage
cleanup() {
    [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR" 2>/dev/null
}
trap cleanup EXIT


# Demande de l'URL - partie critique
if [ -t 0 ]; then
    echo -n "  Entrez l'URL de votre profil Allocine : "
    read -r ALLOCINE_URL
else
    if [ -e /dev/tty ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
        echo -n "  Entrez l'URL de votre profil Allocine : " > /dev/tty
        exec 3</dev/tty
        read -u 3 -r ALLOCINE_URL
        exec 3>&-
    else
        echo -n "  Entrez l'URL de votre profil Allocine : "
        read -r ALLOCINE_URL
    fi
fi

# Validation de l'URL
if [[ ! $ALLOCINE_URL =~ ^https://www\.allocine\.fr/membre-[A-Z0-9] ]]; then
    echo ""
    echo "[ERREUR] URL Allocine invalide !"
    echo "Veuillez fournir une URL valide comme : https://www.allocine.fr/membre-Z20060328181626557554912/films/"
    exit 1
fi

echo ""

# Clonage du dépôt
echo "[*] Configuration de l'environnement..."
TEMP_DIR=$(mktemp -d 2>/dev/null || echo "/tmp/a2l-$$")
git clone --branch "$BRANCH" --depth 1 --quiet "$REPO_URL" "$TEMP_DIR" 2>&1 | grep -v "^hint:" || true
cd "$TEMP_DIR/rust-version"
echo "[OK] Dépôt cloné"

# Installation des dépendances système pour Rust (uniquement gcc, rustls est en Rust pur)
echo "[*] Vérification des dépendances système..."

# Détection du système et installation des paquets requis
if command -v apt-get >/dev/null 2>&1; then
    # Debian/Ubuntu
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installation des outils de compilation (gcc)..."
        sudo apt-get update -qq >/dev/null 2>&1
        sudo apt-get install -y -qq gcc >/dev/null 2>&1
        echo "[OK] Outils de compilation installés"
    fi
elif command -v yum >/dev/null 2>&1; then
    # CentOS/RHEL
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installation des outils de compilation (gcc)..."
        sudo yum install -y gcc >/dev/null 2>&1
        echo "[OK] Outils de compilation installés"
    fi
elif command -v dnf >/dev/null 2>&1; then
    # Fedora
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installation des outils de compilation (gcc)..."
        sudo dnf install -y gcc >/dev/null 2>&1
        echo "[OK] Outils de compilation installés"
    fi
elif command -v apk >/dev/null 2>&1; then
    # Alpine
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installation des outils de compilation (gcc)..."
        sudo apk add --no-cache gcc musl-dev >/dev/null 2>&1
        echo "[OK] Outils de compilation installés"
    fi
elif command -v brew >/dev/null 2>&1; then
    # macOS
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installation des outils de compilation (clang)..."
        xcode-select --install >/dev/null 2>&1 || true
        echo "[OK] Outils de compilation installés"
    fi
fi

echo "[OK] Dépendances système vérifiées"

# Vérification et installation de Rust
echo "[*] Vérification de Rust..."
if ! command -v cargo >/dev/null 2>&1; then
    echo "[!] Rust introuvable. Installation en cours..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y -q
    source "$HOME/.cargo/env"
    echo "[OK] Rust installé"
else
    echo "[OK] Rust est déjà installé"
fi

# Compilation
echo "[*] Compilation..."
cargo build --release --quiet 2>&1 || cargo build --release 2>&1
echo "[OK] Compilation réussie"

# Lancement du scraping
echo ""
echo "[*] Démarrage du scraping..."
echo ""
./target/release/allocine2letterboxd "$ALLOCINE_URL"

# Copie des résultats
ORIGINAL_DIR="${OLDPWD:-$PWD}"
mkdir -p "$ORIGINAL_DIR" 2>/dev/null
[ -f allocine-films.csv ] && cp allocine-films.csv "$ORIGINAL_DIR/"
[ -f allocine-films-a-voir.csv ] && cp allocine-films-a-voir.csv "$ORIGINAL_DIR/"
for f in allocine-films-part*.csv; do
    [ -f "$f" ] && cp "$f" "$ORIGINAL_DIR/"
done

echo ""
echo "[OK] Terminé !"
echo ""
echo "Prochaines étapes :"
echo "  Importer vers Letterboxd :"
echo "    - allocine-films*.csv -> https://letterboxd.com/import/"
echo "    - allocine-films-a-voir.csv -> https://letterboxd.com/watchlist/"
echo ""
