#!/bin/bash

# Allocine2Letterboxd - Rust Version One-Liner
# Simple, universal, works everywhere

# Exit on error
set -e

# Repository info
REPO_URL="https://github.com/Poudlardo/Allocine2Letterboxd.git"
BRANCH="vibe/rust-version-a5b8bf"
TEMP_DIR=""

# Cleanup
cleanup() {
    [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR" 2>/dev/null
}
trap cleanup EXIT

# Print header
echo "  A2L"
echo ""
echo "        Allocine2Letterboxd - Rust Version"
echo "  High-performance scraper for Allocine profiles"
echo ""

# Ask for URL (this MUST work)
echo -n "  Enter your Allocine profile URL: "
read -r ALLOCINE_URL

# Validate URL
if [[ ! $ALLOCINE_URL =~ ^https://www\.allocine\.fr/membre-[A-Z0-9] ]]; then
    echo ""
    echo "[ERROR] Invalid Allocine URL!"
    echo "Please provide a valid URL like: https://www.allocine.fr/membre-Z20060328181626557554912/films/"
    exit 1
fi

echo ""

# Clone repo
echo "[*] Setting up environment..."
TEMP_DIR=$(mktemp -d 2>/dev/null || echo "/tmp/a2l-$$")
git clone --branch "$BRANCH" --depth 1 --quiet "$REPO_URL" "$TEMP_DIR" 2>&1 | grep -v "^hint:" || true
cd "$TEMP_DIR/rust-version"
echo "[OK] Repository cloned"

# Install Rust if needed
echo "[*] Checking Rust..."
if ! command -v cargo >/dev/null 2>&1; then
    echo "[!] Rust not found. Installing..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y -q
    source "$HOME/.cargo/env"
    echo "[OK] Rust installed"
else
    echo "[OK] Rust is already installed"
fi

# Build
echo "[*] Building..."
cargo build --release --quiet 2>&1 || cargo build --release 2>&1
echo "[OK] Build successful"

# Run scraper
echo ""
echo "[*] Starting scrape..."
echo ""
./target/release/allocine2letterboxd "$ALLOCINE_URL"

# Copy results
ORIGINAL_DIR="${OLDPWD:-$PWD}"
mkdir -p "$ORIGINAL_DIR" 2>/dev/null
[ -f allocine-films.csv ] && cp allocine-films.csv "$ORIGINAL_DIR/"
[ -f allocine-films-a-voir.csv ] && cp allocine-films-a-voir.csv "$ORIGINAL_DIR/"

echo ""
echo "[OK] All done!"
echo ""
echo "Next steps:"
echo "  Import to Letterboxd:"
echo "    - allocine-films.csv -> https://letterboxd.com/import/"
echo "    - allocine-films-a-voir.csv -> https://letterboxd.com/watchlist/"
echo ""
