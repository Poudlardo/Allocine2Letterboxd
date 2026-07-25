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
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Check if running as one-liner (piped from curl)
if [ -t 0 ]; then
    # Running interactively
    INTERACTIVE=1
else
    # Running as one-liner (piped)
    INTERACTIVE=0
fi

# Print header
print_header() {
    echo -e "${BLUE}"
    echo "  █████╗ ██╗      ██████╗ ██╗     ███████╗███████╗"
    echo " ██╔══██╗██║     ██╔═══██╗██║     ██╔════╝██╔════╝"
    echo " ███████║██║     ██║   ██║██║     █████╗  ███████╗"
    echo " ██╔══██║██║     ██║   ██║██║     ██╔══╝  ╚════██║"
    echo " ██║  ██║███████╗╚██████╔╝███████╗███████╗███████║"
    echo " ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝"
    echo -e "${NC}"
    echo -e "${CYAN}        Allocine2Letterboxd - Rust Version${NC}"
    echo -e "${YELLOW}  High-performance scraper for Allocine profiles${NC}"
    echo ""
}

# Progress bar function
progress_bar() {
    local current=$1
    local total=$2
    local message=$3
    local width=30
    
    if [ $total -eq 0 ]; then
        total=1
    fi
    
    local percent=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))
    
    local bar=""
    for ((i=0; i<filled; i++)); do
        bar+="█"
    done
    for ((i=0; i<empty; i++)); do
        bar+="░"
    done
    
    printf "\r${CYAN}[%s]${NC} %3d%% (%d/%d) %s" "$bar" "$percent" "$current" "$total" "$message"
}

# Clear progress line
clear_progress() {
    printf "\r\033[K"
}

# Print step with spinner
print_step() {
    local message=$1
    echo -ne "${BLUE}[*]${NC} ${message}..."
}

# Print success
print_success() {
    local message=$1
    clear_progress
    echo -e "${GREEN}[✓]${NC} ${message}"
}

# Print warning
print_warning() {
    local message=$1
    clear_progress
    echo -e "${YELLOW}[!]${NC} ${message}"
}

# Print error
print_error() {
    local message=$1
    clear_progress
    echo -e "${RED}[✗]${NC} ${message}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Main function
main() {
    # Print header
    print_header
    
    # Step 1: Check and install Rust
    print_step "Checking Rust installation"
    if ! command_exists cargo; then
        clear_progress
        echo -e "${YELLOW}[!]${NC} Rust not found. Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
        print_success "Rust installed successfully"
    else
        clear_progress
        print_success "Rust is already installed"
    fi
    
    # Verify Rust version
    RUST_VERSION=$(rustc --version | awk '{print $2}')
    echo -e "  ${CYAN}→${NC} Rust version: $RUST_VERSION"
    
    # Step 2: Build the project
    print_step "Building Allocine2Letterboxd"
    
    # Build with quiet output, show our own progress
    BUILD_OUTPUT=$(cargo build --release 2>&1)
    
    # Count compilation steps
    COMPILING_COUNT=$(echo "$BUILD_OUTPUT" | grep -c "Compiling" || echo "0")
    FINISHED=$(echo "$BUILD_OUTPUT" | grep -c "Finished" || echo "0")
    
    if [ $COMPILING_COUNT -gt 0 ]; then
        clear_progress
        echo -e "  ${CYAN}→${NC} Compiled $COMPILING_COUNT packages"
    fi
    
    if [ $FINISHED -gt 0 ]; then
        print_success "Build successful"
    else
        # If build failed, show error
        echo "$BUILD_OUTPUT"
        print_error "Build failed"
        exit 1
    fi
    
    echo ""
    
    # Step 3: Ask for Allocine URL
    if [ $INTERACTIVE -eq 1 ]; then
        read -p "  Enter your Allocine profile URL: " ALLOCINE_URL
    else
        # For one-liner, check if URL was passed as argument
        if [ $# -gt 0 ]; then
            ALLOCINE_URL=$1
        else
            read -p "  Enter your Allocine profile URL: " ALLOCINE_URL
        fi
    fi
    
    # Validate URL
    if [[ ! $ALLOCINE_URL =~ ^https://www\.allocine\.fr/membre-[A-Z0-9]+ ]]; then
        print_error "Invalid Allocine URL!"
        print_warning "Please provide a valid URL like: https://www.allocine.fr/membre-Z20060328181626557554912/films/"
        exit 1
    fi
    
    echo ""
    print_step "Starting scrape"
    echo ""
    
    # Step 4: Run the scraper
    # The Rust binary will show its own progress bar
    ./target/release/allocine2letterboxd "$ALLOCINE_URL"
    
    SCRAPE_EXIT_CODE=$?
    
    if [ $SCRAPE_EXIT_CODE -ne 0 ]; then
        print_error "Scraping failed with exit code $SCRAPE_EXIT_CODE"
        exit $SCRAPE_EXIT_CODE
    fi
    
    echo ""
    
    # Step 5: Show results
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
    echo "    - allocine-films.csv → https://letterboxd.com/import/"
    echo "    - allocine-films-a-voir.csv → https://letterboxd.com/watchlist/"
    echo ""
}

# Run main with all arguments
main "$@"
