#!/bin/bash

# Allocine2Letterboxd - Rust Version One-Liner Installer
# Universal version that works with: curl | bash, direct execution, all shells

set -e

# Colors for pretty output (works in most terminals)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Simple arrow (ASCII, works everywhere)
ARROW='->'

# Repository info
REPO_URL="https://github.com/Poudlardo/Allocine2Letterboxd.git"
BRANCH="vibe/rust-version-a5b8bf"
TEMP_DIR=""

# Cleanup function
cleanup() {
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR" 2>/dev/null
    fi
}

trap cleanup EXIT

# Print functions - use echo which works everywhere
print_header() {
    printf "%s\n" "  A2L"
    printf "%s\n" ""
    printf "%s\n" "        Allocine2Letterboxd - Rust Version"
    printf "%s\n" "  High-performance scraper for Allocine profiles"
    printf "%s\n" ""
}

print_step() {
    local message=$1
    printf "\r[*] %s..." "$message"
}

print_success() {
    local message=$1
    printf "\r[✓] %s\n" "$message"
}

print_warning() {
    local message=$1
    printf "\r[!] %s\n" "$message"
}

print_error() {
    local message=$1
    printf "\r[✗] %s\n" "$message"
}

print_info() {
    local message=$1
    printf "  %s %s\n" "$ARROW" "$message"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect if we're being run via pipe (curl | bash)
# If stdin is not a terminal, we're being piped
is_piped() {
    ! [ -t 0 ]
}

# Get Allocine URL
get_allocine_url() {
    # Check if URL was passed as argument
    if [ $# -gt 0 ] && [[ "$1" =~ ^https://www\.allocine\.fr/membre-[A-Z0-9] ]]; then
        echo "$1"
        return 0
    fi
    
    # If piped, we can't reliably read from terminal
    # Try to read from stdin with timeout
    if is_piped; then
        # For piped execution, URL must be passed as argument
        # If not, show error with instructions
        printf "\n"
        print_error "When piping (curl | bash), please provide the URL as an argument"
        printf "\n"
        printf "Usage:\n"
        printf "  curl -fsSL ... | bash -s -- <URL>\n"
        printf "  OR\n"
        printf "  curl -fsSL ... | bash\n"
        printf "  (then the script will prompt for URL)\n"
        printf "\n"
        printf "Example:\n"
        printf "  curl -fsSL ... | bash -s -- https://www.allocine.fr/membre-ABC123/films/\n"
        printf "\n"
        exit 1
    fi
    
    # Interactive mode - read from terminal
    printf "  Enter your Allocine profile URL: "
    read -r ALLOCINE_URL
    
    if [ -z "$ALLOCINE_URL" ]; then
        print_error "No URL provided"
        exit 1
    fi
    
    echo "$ALLOCINE_URL"
}

# Main function
main() {
    # Print header
    print_header
    
    # Step 0: Get Allocine URL
    ALLOCINE_URL=$(get_allocine_url "$@")
    
    # Validate URL
    if [[ ! $ALLOCINE_URL =~ ^https://www\.allocine\.fr/membre-[A-Z0-9] ]]; then
        print_error "Invalid Allocine URL!"
        print_warning "Please provide a valid URL like: https://www.allocine.fr/membre-Z20060328181626557554912/films/"
        exit 1
    fi
    
    printf "\n"
    
    # Step 1: Clone the repository to a temp directory
    print_step "Setting up environment"
    TEMP_DIR=$(mktemp -d 2>/dev/null || echo "/tmp/a2l-$$")
    
    if ! git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$TEMP_DIR" 2>&1 | grep -q "Cloning into"; then
        print_error "Failed to clone repository"
        exit 1
    fi
    
    print_success "Repository cloned"
    
    # Change to the cloned directory
    cd "$TEMP_DIR/rust-version"
    
    # Step 2: Check and install Rust
    print_step "Checking Rust installation"
    if ! command_exists cargo; then
        print_warning "Rust not found. Installing Rust..."
        
        # Install Rust
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y -q
        
        # Source the environment
        if [ -f "$HOME/.cargo/env" ]; then
            . "$HOME/.cargo/env"
        fi
        
        print_success "Rust installed successfully"
    else
        print_success "Rust is already installed"
    fi
    
    # Verify Rust version
    if command_exists rustc; then
        RUST_VERSION=$(rustc --version | awk '{print $2}')
        print_info "Rust version: $RUST_VERSION"
    fi
    
    # Step 3: Build the project
    print_step "Building A2L"
    
    # Build the project
    if cargo build --release --quiet 2>&1; then
        print_success "Build successful"
    else
        # Try with full output for debugging
        print_warning "Build failed, trying with verbose output..."
        cargo build --release 2>&1
        print_error "Build failed"
        exit 1
    fi
    
    printf "\n"
    print_step "Starting scrape"
    printf "\n"
    
    # Step 4: Run the scraper
    if ./target/release/allocine2letterboxd "$ALLOCINE_URL"; then
        printf "\n"
    else
        SCRAPE_EXIT_CODE=$?
        print_error "Scraping failed with exit code $SCRAPE_EXIT_CODE"
        exit $SCRAPE_EXIT_CODE
    fi
    
    # Step 5: Copy CSV files to original directory
    ORIGINAL_DIR="${OLDPWD:-$PWD}"
    
    # Create original directory if it doesn't exist
    mkdir -p "$ORIGINAL_DIR" 2>/dev/null
    
    if [ -f "allocine-films.csv" ]; then
        cp allocine-films.csv "$ORIGINAL_DIR/" 2>/dev/null || true
    fi
    
    if [ -f "allocine-films-a-voir.csv" ]; then
        cp allocine-films-a-voir.csv "$ORIGINAL_DIR/" 2>/dev/null || true
    fi
    
    # Step 6: Show results
    printf "\n"
    print_success "All done!"
    printf "\n"
    
    # Check if CSV files were created
    if [ -f "$ORIGINAL_DIR/allocine-films.csv" ]; then
        FILM_COUNT=$(tail -n +2 "$ORIGINAL_DIR/allocine-films.csv" 2>/dev/null | wc -l)
        print_success "Exported $FILM_COUNT films to $ORIGINAL_DIR/allocine-films.csv"
    elif [ -f "allocine-films.csv" ]; then
        FILM_COUNT=$(tail -n +2 allocine-films.csv 2>/dev/null | wc -l)
        print_success "Exported $FILM_COUNT films to allocine-films.csv"
    fi
    
    if [ -f "$ORIGINAL_DIR/allocine-films-a-voir.csv" ]; then
        WISHLIST_COUNT=$(tail -n +2 "$ORIGINAL_DIR/allocine-films-a-voir.csv" 2>/dev/null | wc -l)
        print_success "Exported $WISHLIST_COUNT wishlist items to $ORIGINAL_DIR/allocine-films-a-voir.csv"
    elif [ -f "allocine-films-a-voir.csv" ]; then
        WISHLIST_COUNT=$(tail -n +2 allocine-films-a-voir.csv 2>/dev/null | wc -l)
        print_success "Exported $WISHLIST_COUNT wishlist items to allocine-films-a-voir.csv"
    fi
    
    printf "\n"
    printf "Next steps:\n"
    printf "  Import to Letterboxd:\n"
    printf "    - allocine-films.csv %s https://letterboxd.com/import/\n" "$ARROW"
    printf "    - allocine-films-a-voir.csv %s https://letterboxd.com/watchlist/\n" "$ARROW"
    printf "\n"
}

# Run main with all arguments
main "$@"
