#!/bin/bash

# Allocine2Letterboxd - Rust Version One-Liner Installer
# Works exactly like the JavaScript version: curl -fsSL ... | bash

set -e

# Colors for pretty output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Simple arrow
ARROW='->'

# Repository info
REPO_URL="https://github.com/Poudlardo/Allocine2Letterboxd.git"
BRANCH="vibe/rust-version-a5b8bf"
TEMP_DIR=""

# Always read from terminal for user input, not stdin
# This is critical when script is piped via curl | bash
exec 3<>/dev/tty

# Check if running as one-liner (piped from curl)
if [ -t 0 ]; then
    INTERACTIVE=1
else
    INTERACTIVE=0
fi

# Cleanup function
cleanup() {
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
    exec 3>&-
}

trap cleanup EXIT

# Clear current line
clear_line() {
    printf "\r\033[K" >&3
}

# Print header
print_header() {
    echo -e "${BLUE}" >&3
    echo "  A2L" >&3
    echo -e "${NC}" >&3
    echo -e "${CYAN}        Allocine2Letterboxd - Rust Version${NC}" >&3
    echo -e "${YELLOW}  High-performance scraper for Allocine profiles${NC}" >&3
    echo "" >&3
}

# Print step
print_step() {
    local message=$1
    clear_line
    echo -ne "${BLUE}[*]${NC} ${message}..." >&3
}

# Print success
print_success() {
    local message=$1
    clear_line
    echo -e "${GREEN}[✓]${NC} ${message}" >&3
}

# Print warning
print_warning() {
    local message=$1
    clear_line
    echo -e "${YELLOW}[!]${NC} ${message}" >&3
}

# Print error
print_error() {
    local message=$1
    clear_line
    echo -e "${RED}[✗]${NC} ${message}" >&3
}

# Print info
print_info() {
    local message=$1
    clear_line
    echo -e "  ${CYAN}${ARROW}${NC} ${message}" >&3
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Main function
main() {
    # Print header
    print_header
    
    # Step 0: Ask for Allocine URL FIRST (before any installation)
    # Read from /dev/tty (file descriptor 3) to avoid conflict with stdin when piped
    echo -n "  Enter your Allocine profile URL: " >&3
    read -u 3 ALLOCINE_URL
    
    # Validate URL - more permissive pattern
    if [[ ! $ALLOCINE_URL =~ ^https://www\.allocine\.fr/membre-[A-Z0-9] ]]; then
        print_error "Invalid Allocine URL!"
        print_warning "Please provide a valid URL like: https://www.allocine.fr/membre-Z20060328181626557554912/films/"
        exit 1
    fi
    
    echo "" >&3
    
    # Step 1: Clone the repository to a temp directory
    print_step "Setting up environment"
    TEMP_DIR=$(mktemp -d)
    
    if git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$TEMP_DIR" 2>&1 | grep -q "Cloning into"; then
        clear_line
        print_success "Repository cloned"
    else
        clear_line
        print_error "Failed to clone repository"
        exit 1
    fi
    
    # Change to the cloned directory
    cd "$TEMP_DIR/rust-version"
    
    # Step 2: Check and install Rust
    print_step "Checking Rust installation"
    if ! command_exists cargo; then
        clear_line
        print_warning "Rust not found. Installing Rust..."
        
        # Install Rust silently
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y -q
        
        # Source the environment
        source "$HOME/.cargo/env"
        
        clear_line
        print_success "Rust installed successfully"
    else
        clear_line
        print_success "Rust is already installed"
    fi
    
    # Verify Rust version
    RUST_VERSION=$(rustc --version | awk '{print $2}')
    print_info "Rust version: $RUST_VERSION"
    
    # Step 3: Build the project
    print_step "Building A2L"
    
    # Build the project
    if cargo build --release --quiet 2>&1; then
        clear_line
        print_success "Build successful"
    else
        # Try with full output for debugging
        clear_line
        print_warning "Build failed, trying with verbose output..."
        cargo build --release 2>&1
        clear_line
        print_error "Build failed"
        exit 1
    fi
    
    echo "" >&3
    print_step "Starting scrape"
    echo "" >&3
    
    # Step 4: Run the scraper
    if ./target/release/allocine2letterboxd "$ALLOCINE_URL"; then
        echo "" >&3
    else
        SCRAPE_EXIT_CODE=$?
        clear_line
        print_error "Scraping failed with exit code $SCRAPE_EXIT_CODE"
        exit $SCRAPE_EXIT_CODE
    fi
    
    # Step 5: Copy CSV files to current directory before cleanup
    ORIGINAL_DIR=$(pwd -P)
    if [ -f "allocine-films.csv" ]; then
        cp allocine-films.csv "$ORIGINAL_DIR/" 2>/dev/null || true
    fi
    
    if [ -f "allocine-films-a-voir.csv" ]; then
        cp allocine-films-a-voir.csv "$ORIGINAL_DIR/" 2>/dev/null || true
    fi
    
    # Step 6: Show results
    print_success "All done!"
    echo "" >&3
    
    # Check if CSV files were created
    if [ -f "$ORIGINAL_DIR/allocine-films.csv" ]; then
        FILM_COUNT=$(tail -n +2 "$ORIGINAL_DIR/allocine-films.csv" | wc -l)
        print_success "Exported $FILM_COUNT films to $ORIGINAL_DIR/allocine-films.csv"
    elif [ -f "allocine-films.csv" ]; then
        FILM_COUNT=$(tail -n +2 allocine-films.csv | wc -l)
        print_success "Exported $FILM_COUNT films to allocine-films.csv"
    fi
    
    if [ -f "$ORIGINAL_DIR/allocine-films-a-voir.csv" ]; then
        WISHLIST_COUNT=$(tail -n +2 "$ORIGINAL_DIR/allocine-films-a-voir.csv" | wc -l)
        print_success "Exported $WISHLIST_COUNT wishlist items to $ORIGINAL_DIR/allocine-films-a-voir.csv"
    elif [ -f "allocine-films-a-voir.csv" ]; then
        WISHLIST_COUNT=$(tail -n +2 allocine-films-a-voir.csv | wc -l)
        print_success "Exported $WISHLIST_COUNT wishlist items to allocine-films-a-voir.csv"
    fi
    
    echo "" >&3
    echo -e "${CYAN}Next steps:${NC}" >&3
    echo "  Import to Letterboxd:" >&3
    echo "    - allocine-films.csv ${ARROW} https://letterboxd.com/import/" >&3
    echo "    - allocine-films-a-voir.csv ${ARROW} https://letterboxd.com/watchlist/" >&3
    echo "" >&3
}

# Run main with all arguments
main "$@"
