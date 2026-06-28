# Using NVIDIA Nemotron with SC CLI

NVIDIA Nemotron 3 Ultra 550B is a powerful reasoning model available through NVIDIA's API Gateway.

## Prerequisites

- NVIDIA API key from https://build.nvidia.com/
- SC CLI installed and configured

## Quick Setup

### Option 1: Using Environment Variable (Recommended)

```bash
# Set your NVIDIA API key
export NVIDIA_API_KEY="nvapi-your-key-here"

# Switch to NVIDIA profile
sc profile use nvidia

# Start chatting
sc
```

### Option 2: Using Config File

```bash
# Edit global config
nano ~/.sc-agent/config.json
```

Replace `<YOUR_NVIDIA_KEY>` with your actual API key in the `nvidia` profile:

```json
{
  "profiles": {
    "nvidia": {
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "apiKey": "nvapi-your-actual-key-here",
      "model": "nvidia/nemotron-3-ultra-550b-a55b",
      "temperature": 1,
      "maxTokens": 16384
    }
  }
}
```

Then:

```bash
sc profile use nvidia
sc
```

## Getting Your API Key

1. Go to https://build.nvidia.com/
2. Sign in with your NVIDIA account
3. Navigate to the Nemotron 3 Ultra model page
4. Click "Get API Key"
5. Copy your API key (starts with `nvapi-`)

## Model Features

- **Size**: 550B parameters
- **Reasoning**: Advanced chain-of-thought capabilities
- **Context**: Up to 16,384 tokens
- **Streaming**: Full streaming support
- **Cost**: Check NVIDIA's pricing page for current rates

## Example Session

```bash
# Set API key
export NVIDIA_API_KEY="nvapi-your-nvidia-key-here"

# Use NVIDIA profile
sc profile use nvidia

# Start
sc

# Chat
You: Explain how quicksort works and write a Python implementation