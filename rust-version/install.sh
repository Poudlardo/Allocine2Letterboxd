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

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if running as one-liner (piped from curl)
if [ -t 0 ]; then
    INTERACTIVE=1
else
    INTERACTIVE=0
fi

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
    
    # Step 1: Check and install Rust
    print_step "Checking Rust installation"
    if ! command_exists cargo; then
        clear_line
        print_warning "Rust not found. Installing Rust..."
        
        # Install Rust silently (suppress most output)
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
    
    # Step 2: Change to script directory and build
    print_step "Building A2L"
    
    # Change to the directory where Cargo.toml is located
    cd "$SCRIPT_DIR"
    
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
    
    # Step 3: Run the scraper from the script directory
    if ./target/release/allocine2letterboxd "$ALLOCINE_URL"; then
        echo ""
    else
        SCRAPE_EXIT_CODE=$?
        clear_line
        print_error "Scraping failed with exit code $SCRAPE_EXIT_CODE"
        exit $SCRAPE_EXIT_CODE
    fi
    
    # Step 4: Show results
    print_success "All done!"
    echo ""
    
    # Check if CSV files were created
    if [ -f "allocine-films.csv" ]; then
        FILM_COUNT=$(tail -n +2 allocine-films.csv | wc -l)
        print_success "Exported $FILM_COUNT films to allocine-films.csv"
    fi
    
    if [ -f "allocine-films-a-voir.csv" ]; then
        WISHLIST_COUNT=$(tail -n +2 allocine-films-a-voir.csv | wc -l)
        print_success "Exported $WISHLIST_COUNT wishlist items to allocine-films-a-voir.csv"
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
