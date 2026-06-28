#!/bin/bash
# Setup script for SC CLI in WSL

set -e

echo "🔧 Setting up SC CLI in WSL..."
echo ""

# Detect WSL
if ! grep -qi microsoft /proc/version 2>/dev/null; then
    echo "⚠️  Warning: This doesn't appear to be WSL"
    echo "   This script is designed for Windows Subsystem for Linux"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed in WSL"
    echo ""
    echo "Install Node.js first:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✓ Node.js installed: $NODE_VERSION"

# Find the sc-agent-cli path (from Windows filesystem)
SC_CLI_PATH="/mnt/d/git/sc-agent-cli/bin/sc.js"

if [ ! -f "$SC_CLI_PATH" ]; then
    echo "❌ SC CLI not found at: $SC_CLI_PATH"
    echo ""
    echo "Please adjust the path in this script or ensure the project is at:"
    echo "  D:\\git\\sc-agent-cli (Windows)"
    echo "  /mnt/d/git/sc-agent-cli (WSL)"
    exit 1
fi

echo "✓ SC CLI found at: $SC_CLI_PATH"

# Backup .bashrc
if [ -f ~/.bashrc ]; then
    cp ~/.bashrc ~/.bashrc.backup.$(date +%Y%m%d_%H%M%S)
    echo "✓ Backed up .bashrc"
fi

# Check if already configured
if grep -q "SC CLI (Provider-agnostic AI Agent)" ~/.bashrc 2>/dev/null; then
    echo "⚠️  SC CLI already configured in .bashrc"
    echo ""
    read -p "Overwrite existing configuration? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping .bashrc modification"
    else
        # Remove old configuration
        sed -i '/# --- SC CLI (Provider-agnostic AI Agent) ---/,/^$/d' ~/.bashrc
        echo "✓ Removed old configuration"
    fi
fi

# Add configuration to .bashrc
cat >> ~/.bashrc << 'EOF'

# --- SC CLI (Provider-agnostic AI Agent) ---
# NVIDIA API Key for Nemotron 3 Ultra 550B
export NVIDIA_API_KEY="nvapi-your-nvidia-key-here"

# SC CLI alias
alias scc='node /mnt/d/git/sc-agent-cli/bin/sc.js'

# Reload bash profile
reload() {
    echo "♻️  Reloading bash profile..."
    source ~/.bashrc
    echo "✓ Profile reloaded successfully!"
}

EOF

echo "✓ Added SC CLI configuration to .bashrc"

# Reload .bashrc
source ~/.bashrc

# Test the command
echo ""
echo "Testing scc command..."
if node "$SC_CLI_PATH" --version &> /dev/null; then
    VERSION=$(node "$SC_CLI_PATH" --version)
    echo "✓ scc is working! Version: $VERSION"
else
    echo "❌ scc command failed"
    exit 1
fi

# Configure NVIDIA profile
echo ""
echo "Configuring NVIDIA profile..."
node "$SC_CLI_PATH" profile use nvidia

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ SC CLI setup complete!"
echo ""
echo "Available commands:"
echo "  scc --help          → Show help"
echo "  scc profile list    → List available profiles"
echo "  scc                 → Start chat with NVIDIA Nemotron"
echo ""
echo "Environment:"
echo "  NVIDIA_API_KEY is configured"
echo "  Active profile: nvidia (Nemotron 3 Ultra 550B)"
echo ""
echo "To start chatting:"
echo "  scc"
echo ""
echo "Note: Close and reopen your terminal, or run:"
echo "  source ~/.bashrc"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
