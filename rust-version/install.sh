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
}

trap cleanup EXIT

# Clear current line
clear_line() {
    printf "\r\033[K"
}

# Print header
print_header() {
    echo -e "${BLUE}"
    echo "  A2L"
    echo -e "${NC}"
    echo -e "${CYAN}        Allocine2Letterboxd - Rust Version${NC}"
    echo -e "${YELLOW}  High-performance scraper for Allocine profiles${NC}"
    echo ""
}

# Print step
print_step() {
    local message=$1
    clear_line
    echo -ne "${BLUE}[*]${NC} ${message}..."
}

# Print success
print_success() {
    local message=$1
    clear_line
    echo -e "${GREEN}[✓]${NC} ${message}"
}

# Print warning
print_warning() {
    local message=$1
    clear_line
    echo -e "${YELLOW}[!]${NC} ${message}"
}

# Print error
print_error() {
    local message=$1
    clear_line
    echo -e "${RED}[✗]${NC} ${message}"
}

# Print info
print_info() {
    local message=$1
    clear_line
    echo -e "  ${CYAN}${ARROW}${NC} ${message}"
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
    if [ $INTERACTIVE -eq 1 ]; then
        read -p "  Enter your Allocine profile URL: " ALLOCINE_URL
    else
        if [ $# -gt 0 ]; then
            ALLOCINE_URL=$1
        else
            read -p "  Enter your Allocine profile URL: " ALLOCINE_URL
        fi
    fi
    
    # Validate URL - more permissive pattern
    if [[ ! $ALLOCINE_URL =~ ^https://www\.allocine\.fr/membre-[A-Z0-9] ]]; then
        print_error "Invalid Allocine URL!"
        print_warning "Please provide a valid URL like: https://www.allocine.fr/membre-Z20060328181626557554912/films/"
        exit 1
    fi
    
    echo ""
    
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
    
    echo ""
    print_step "Starting scrape"
    echo ""
    
    # Step 4: Run the scraper
    if ./target/release/allocine2letterboxd "$ALLOCINE_URL"; then
        echo ""
    else
        SCRAPE_EXIT_CODE=$?
        clear_line
        print_error "Scraping failed with exit code $SCRAPE_EXIT_CODE"
        exit $SCRAPE_EXIT_CODE
    fi
    
    # Step 5: Copy CSV files to current directory before cleanup
    if [ -f "allocine-films.csv" ]; then
        cp allocine-films.csv "$OLDPWD/" 2>/dev/null || cp allocine-films.csv .
    fi
    
    if [ -f "allocine-films-a-voir.csv" ]; then
        cp allocine-films-a-voir.csv "$OLDPWD/" 2>/dev/null || cp allocine-films-a-voir.csv .
    fi
    
    # Step 6: Show results
    print_success "All done!"
    echo ""
    
    # Check if CSV files were created
    if [ -f "allocine-films.csv" ] || [ -f "$OLDPWD/allocine-films.csv" ]; then
        CSV_PATH="allocine-films.csv"
        if [ ! -f "$CSV_PATH" ] && [ -f "$OLDPWD/allocine-films.csv" ]; then
            CSV_PATH="$OLDPWD/allocine-films.csv"
        fi
        FILM_COUNT=$(tail -n +2 "$CSV_PATH" | wc -l)
        print_success "Exported $FILM_COUNT films to $CSV_PATH"
    fi
    
    if [ -f "allocine-films-a-voir.csv" ] || [ -f "$OLDPWD/allocine-films-a-voir.csv" ]; then
        WISH_PATH="allocine-films-a-voir.csv"
        if [ ! -f "$WISH_PATH" ] && [ -f "$OLDPWD/allocine-films-a-voir.csv" ]; then
            WISH_PATH="$OLDPWD/allocine-films-a-voir.csv"
        fi
        WISHLIST_COUNT=$(tail -n +2 "$WISH_PATH" | wc -l)
        print_success "Exported $WISHLIST_COUNT wishlist items to $WISH_PATH"
    fi
    
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo "  Import to Letterboxd:"
    echo "    - allocine-films.csv ${ARROW} https://letterboxd.com/import/"
    echo "    - allocine-films-a-voir.csv ${ARROW} https://letterboxd.com/watchlist/"
    echo ""
}

# Run main with all arguments
main "$@"
