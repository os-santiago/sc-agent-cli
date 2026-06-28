# Using Anthropic Models with SC-Agent CLI

Since Anthropic's API uses a different message format than OpenAI, you need a proxy to translate between formats. Here are three options:

## Option 1: LiteLLM Proxy (Recommended)

[LiteLLM](https://github.com/BerriAI/litellm) provides an OpenAI-compatible proxy for Anthropic and 100+ other providers.

### Installation

```bash
pip install litellm
```

### Start the Proxy

```bash
export ANTHROPIC_API_KEY="your-key-here"
litellm --model anthropic/claude-sonnet-4-6 --port 8000
```

### Configure SC-Agent

```bash
sc-agent profile add anthropic
# Enter:
#   Base URL: http://localhost:8000/v1
#   Model: anthropic/claude-sonnet-4-6
#   API Key: (leave empty, LiteLLM handles auth)

sc-agent profile use anthropic
sc-agent
```

## Option 2: OpenAI SDK with Anthropic Backend

If you're already using the OpenAI SDK, you can point it at Anthropic's API with some configuration.

**Note**: This requires a custom proxy script. Here's a minimal example:

```javascript
// proxy.js
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/v1/chat/completions', express.json(), async (req, res) => {
  const { messages, model, temperature, max_tokens } = req.body;

  // Transform OpenAI format → Anthropic format
  const system = messages.find(m => m.role === 'system')?.content;
  const userMessages = messages.filter(m => m.role !== 'system');

  const stream = await anthropic.messages.stream({
    model,
    max_tokens: max_tokens || 4096,
    temperature: temperature || 0.7,
    system,
    messages: userMessages,
  });

  res.setHeader('Content-Type', 'text/event-stream');

  for await (const event of stream) {
    // Transform Anthropic SSE → OpenAI SSE
    if (event.type === 'content_block_delta') {
      const chunk = {
        choices: [{
          delta: { content: event.delta.text },
        }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

app.listen(8000, () => console.log('Proxy running on http://localhost:8000'));
```

Run it:

```bash
npm install @anthropic-ai/sdk express
export ANTHROPIC_API_KEY="your-key-here"
node proxy.js
```

Then configure SC-Agent as in Option 1.

## Option 3: Native Anthropic Provider (Future)

A future version of SC-Agent CLI could add native support for the Anthropic Messages API. This would require:

1. Creating `src/core/anthropic-provider.ts`
2. Implementing the same interface as `OpenAICompatibleProvider`
3. Handling Anthropic-specific message format and streaming

**Contribution welcome!** See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## Comparison

| Option     | Setup Complexity | Features               | Dependencies         |
|------------|------------------|------------------------|----------------------|
| LiteLLM    | Low              | Full (all providers)   | Python + litellm     |
| Custom     | Medium           | Minimal (Anthropic only) | Node + custom script |
| Native     | N/A (future)     | Full (no proxy)        | None                 |

## Recommended Models

- **claude-sonnet-4-6**: Fastest, best for most tasks
- **claude-opus-4**: Most capable, for complex reasoning
- **claude-haiku-4**: Ultra-fast, for simple tasks

See [Anthropic's model documentation](https://docs.anthropic.com/en/docs/about-claude/models) for details.

## Troubleshooting

### "Connection refused" on http://localhost:8000

Make sure the proxy is running:

```bash
# For LiteLLM
litellm --model anthropic/claude-sonnet-4-6 --port 8000

# For custom proxy
node proxy.js
```

### "API key not found"

Set the environment variable before starting the proxy:

```bash
export ANTHROPIC_API_KEY="sk-ant-api..."
# Then start the proxy
```

### Stream parsing errors

Make sure the proxy correctly transforms Anthropic's SSE format to OpenAI's format. LiteLLM handles this automatically.

## Example Session

```bash
# Start LiteLLM proxy
export ANTHROPIC_API_KEY="sk-ant-..."
litellm --model anthropic/claude-sonnet-4-6 --port 8000

# In another terminal
sc-agent profile use anthropic
sc-agent

You: explain this project
Assistant: [Claude Sonnet 4.6 via LiteLLM responds with streaming output...]
```

## References

- [Anthropic API Documentation](https://docs.anthropic.com/)
- [LiteLLM Documentation](https://docs.litellm.ai/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
