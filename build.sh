#!/bin/bash

# Build script for Allocine2Letterboxd Rust version

set -e

echo "=========================================="
echo "  Allocine2Letterboxd - Rust Version Build"
echo "=========================================="
echo ""

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Error: Rust/Cargo not found!"
    echo ""
    echo "Please install Rust first:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo ""
    exit 1
fi

# Check Rust version
RUST_VERSION=$(rustc --version | awk '{print $2}')
echo "✅ Rust version: $RUST_VERSION"

if [[ "$RUST_VERSION" < "1.70.0" ]]; then
    echo "⚠️  Warning: Rust 1.70 or later recommended"
fi

# Build in release mode
echo ""
echo "🔨 Building in release mode..."
cargo build --release

echo ""
echo "✅ Build successful!"
echo ""
echo "Binary location: target/release/allocine2letterboxd"
echo ""
echo "To run:"
echo "  ./target/release/allocine2letterboxd --help"
echo ""

# Offer to install system-wide
read -p "Install system-wide? (y/N): " -n 1 -r
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "📦 Installing system-wide..."
    cargo install --path . --force
    echo ""
    echo "✅ Installed to: ~/.cargo/bin/allocine2letterboxd"
    echo ""
    echo "Make sure ~/.cargo/bin is in your PATH:"
    echo "  export PATH=\"\$HOME/.cargo/bin:\$PATH\""
fi
