#!/bin/bash

# Allocine2Letterboxd - Rust Version One-Liner
# Universal version that works with curl | bash

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

# Ask for URL - this is the critical part
if [ -t 0 ]; then
    echo -n "  Enter your Allocine profile URL: "
    read -r ALLOCINE_URL
else
    if [ -e /dev/tty ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
        echo -n "  Enter your Allocine profile URL: " > /dev/tty
        exec 3</dev/tty
        read -u 3 -r ALLOCINE_URL
        exec 3>&-
    else
        echo -n "  Enter your Allocine profile URL: "
        read -r ALLOCINE_URL
    fi
fi

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

# Install system dependencies for Rust
echo "[*] Checking system dependencies..."
if command -v apt-get >/dev/null 2>&1; then
    # Debian/Ubuntu
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installing build tools (gcc)..."
        sudo apt-get update -qq >/dev/null 2>&1
        sudo apt-get install -y -qq gcc >/dev/null 2>&1
        echo "[OK] Build tools installed"
    fi
elif command -v yum >/dev/null 2>&1; then
    # CentOS/RHEL
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installing build tools (gcc)..."
        sudo yum install -y gcc >/dev/null 2>&1
        echo "[OK] Build tools installed"
    fi
elif command -v dnf >/dev/null 2>&1; then
    # Fedora
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installing build tools (gcc)..."
        sudo dnf install -y gcc >/dev/null 2>&1
        echo "[OK] Build tools installed"
    fi
elif command -v apk >/dev/null 2>&1; then
    # Alpine
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installing build tools (gcc)..."
        sudo apk add --no-cache gcc musl-dev >/dev/null 2>&1
        echo "[OK] Build tools installed"
    fi
elif command -v brew >/dev/null 2>&1; then
    # macOS
    if ! command -v cc >/dev/null 2>&1; then
        echo "[!] Installing build tools (clang)..."
        brew install gcc >/dev/null 2>&1 || true
        echo "[OK] Build tools installed"
    fi
fi

# Check and install Rust
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
