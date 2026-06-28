#!/bin/bash
# Quick test script for NVIDIA Nemotron profile

set -e

if [ -z "$NVIDIA_API_KEY" ]; then
  echo "❌ Error: NVIDIA_API_KEY environment variable is not set"
  echo ""
  echo "Get your API key from: https://build.nvidia.com/"
  echo "Then run:"
  echo "  export NVIDIA_API_KEY=\"nvapi-your-key-here\""
  echo "  $0"
  exit 1
fi

echo "✓ NVIDIA_API_KEY is set"
echo ""
echo "Switching to NVIDIA profile..."
node bin/sc.js profile use nvidia

echo ""
echo "Starting chat with NVIDIA Nemotron 3 Ultra 550B..."
echo "You can test with: 'write a hello world function in Python'"
echo ""

node bin/sc.js chat
