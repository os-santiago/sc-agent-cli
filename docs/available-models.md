# Available Models

SC CLI comes pre-configured with multiple model profiles. You can switch between them using `scc profile use <name>` or `/model` during a chat session.

## Pre-configured Profiles

### 1. Ollama (Local)

**Profile name:** `ollama`

```json
{
  "model": "llama3.2",
  "baseUrl": "http://localhost:11434/v1",
  "cost": "Free (runs locally)"
}
```

**Features:**
- Runs completely offline
- No API key needed
- Zero cost
- Privacy-first (data never leaves your machine)

**Setup:**
```bash
# Install Ollama from https://ollama.com
ollama pull llama3.2
scc profile use ollama
```

---

### 2. OpenAI GPT-4o

**Profile name:** `openai`

```json
{
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "requires": "OPENAI_API_KEY environment variable"
}
```

**Features:**
- Most capable for general tasks
- Strong reasoning and coding
- Fast response times
- Pay-per-token pricing

**Setup:**
```bash
export OPENAI_API_KEY="sk-your-key-here"
scc profile use openai
```

---

### 3. Anthropic Claude Sonnet 4.6

**Profile name:** `anthropic`

```json
{
  "model": "claude-sonnet-4-6",
  "baseUrl": "https://api.anthropic.com/v1",
  "requires": "ANTHROPIC_API_KEY + LiteLLM proxy"
}
```

**Features:**
- Excellent for analysis and writing
- Strong at following instructions
- Good context window
- Requires proxy for OpenAI-compatible format

**Setup:**
```bash
# Install LiteLLM
pip install litellm

# Start proxy
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
litellm --model anthropic/claude-sonnet-4-6 --port 8000

# Use profile
scc profile use anthropic
```

See [docs/anthropic-setup.md](anthropic-setup.md) for details.

---

### 4. NVIDIA Nemotron 3 Ultra 550B

**Profile name:** `nvidia`

```json
{
  "model": "nvidia/nemotron-3-ultra-550b-a55b",
  "baseUrl": "https://integrate.api.nvidia.com/v1",
  "temperature": 1.0,
  "maxTokens": 16384,
  "requires": "NVIDIA_API_KEY environment variable"
}
```

**Features:**
- 550B parameters (very large)
- Advanced reasoning with chain-of-thought
- Excellent for complex tasks
- Supports reasoning budget up to 16K tokens

**Setup:**
```bash
export NVIDIA_API_KEY="nvapi-your-key-here"
scc profile use nvidia
```

**API Key:** Get from https://build.nvidia.com/

See [docs/nvidia-nemotron-setup.md](nvidia-nemotron-setup.md) for details.

---

### 5. Meta Llama 3.3 70B Instruct (NEW)

**Profile name:** `llama-3.3-70b`

```json
{
  "model": "meta/llama-3.3-70b-instruct",
  "baseUrl": "https://integrate.api.nvidia.com/v1",
  "temperature": 0.2,
  "maxTokens": 1024,
  "requires": "NVIDIA_API_KEY environment variable"
}
```

**Features:**
- 70B parameters (efficient and fast)
- Optimized for instruction following
- Lower temperature for more focused responses
- Same NVIDIA endpoint as Nemotron

**Setup:**
```bash
# Uses same NVIDIA_API_KEY as nemotron profile
export NVIDIA_API_KEY="nvapi-your-key-here"
scc profile use llama-3.3-70b
```

**Use cases:**
- Code generation and debugging
- Technical documentation
- Precise question answering
- Structured output tasks

---

## Switching Models

### During Setup

```bash
# List available profiles
scc profile list

# Switch to a profile
scc profile use llama-3.3-70b
```

### During Chat Session

Use the `/model` command:

```
You: /model
? Select a model profile:
  ❯ llama-3.3-70b - meta/llama-3.3-70b-instruct
    nvidia (current) - nvidia/nemotron-3-ultra-550b-a55b
    ollama - llama3.2
    openai - gpt-4o
    anthropic - claude-sonnet-4-6

✓ Switched to: llama-3.3-70b
  Model: meta/llama-3.3-70b-instruct
  Provider: https://integrate.api.nvidia.com/v1
```

**Note:** Switching models clears conversation history.

---

## Chat Commands

When in a chat session, you can use these commands:

- `/help` - Show available commands
- `/model` - Switch to a different model
- `/clear` - Clear conversation history
- `/info` - Show current model and config
- `exit` or `quit` - End the session

---

## Environment Variables

API keys are loaded from environment variables in this priority order:

1. `SC_API_KEY` (highest priority, works for all)
2. Provider-specific keys:
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `NVIDIA_API_KEY`
3. Config file (lowest priority)

**Example:**

```bash
# Set for current session
export NVIDIA_API_KEY="nvapi-your-key-here"

# Or set a general key that works for all providers
export SC_API_KEY="your-api-key-here"
```

---

## API Key Management

### Multiple NVIDIA Models

Both `nvidia` (Nemotron) and `llama-3.3-70b` use the same NVIDIA endpoint and API key:

```bash
# One API key works for both
export NVIDIA_API_KEY="nvapi-your-key-here"

# Switch freely between them
scc profile use nvidia         # Nemotron 3 Ultra 550B
scc profile use llama-3.3-70b  # Llama 3.3 70B
```

### Different API Keys for Different Models

If you have different NVIDIA API keys for different models:

```bash
# Method 1: Use SC_API_KEY as override
export NVIDIA_API_KEY="nvapi-key-for-nemotron"
export SC_API_KEY="nvapi-key-for-llama"  # This takes precedence

# Method 2: Edit config file manually
nano ~/.sc-agent/config.json
# Set different apiKey for each profile
```

---

## Comparison

| Profile       | Model                    | Size  | Speed | Cost      | Use Case              |
|---------------|--------------------------|-------|-------|-----------|-----------------------|
| ollama        | llama3.2                 | 3B    | Fast  | Free      | Local, privacy        |
| llama-3.3-70b | Llama 3.3 70B Instruct   | 70B   | Fast  | Low       | Code, technical tasks |
| nvidia        | Nemotron 3 Ultra 550B    | 550B  | Slow  | Medium    | Complex reasoning     |
| openai        | GPT-4o                   | ?     | Fast  | High      | General purpose       |
| anthropic     | Claude Sonnet 4.6        | ?     | Medium| High      | Analysis, writing     |

---

## Adding Custom Models

You can add your own models via CLI:

```bash
scc profile add my-custom-model
# Enter base URL: http://localhost:8080/v1
# Enter model name: my-model-name
# Enter API key: (leave empty if none)

scc profile use my-custom-model
```

Or edit `~/.sc-agent/config.json` directly:

```json
{
  "profiles": {
    "my-custom": {
      "baseUrl": "http://localhost:8080/v1",
      "model": "my-model-name",
      "apiKey": "<YOUR_KEY>",
      "temperature": 0.7,
      "maxTokens": 4096
    }
  }
}
```

---

## Troubleshooting

### "API key not found"

Make sure environment variable is set:

```bash
# Check current value
echo $NVIDIA_API_KEY

# Set if empty
export NVIDIA_API_KEY="nvapi-your-key-here"
```

### "Model not responding"

1. Check API key is valid
2. Check internet connection (for cloud models)
3. Try a different model: `/model`
4. Check provider status (NVIDIA, OpenAI, etc.)

### "Permission denied"

Some tools require explicit permission. Either:
- Approve interactively when prompted
- Add to auto-approve: Edit `~/.sc-agent/config.json`
- Use `scc chat -y` to auto-approve all (use with caution)

---

## Next Steps

1. **Try different models:**
   ```bash
   scc
   You: /model
   # Select llama-3.3-70b
   You: explain how quicksort works
   ```

2. **Compare responses:**
   - Ask the same question to different models
   - See which one gives the best answer for your use case

3. **Use appropriate model for the task:**
   - Quick code fixes → `llama-3.3-70b`
   - Complex reasoning → `nvidia` (Nemotron)
   - General chat → `openai` or `ollama`
   - Analysis/writing → `anthropic`
