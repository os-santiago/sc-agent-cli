import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';
import type { ModelConfig } from './types.js';

const originalFetch = globalThis.fetch;

function createProvider(baseUrl: string): OpenAICompatibleProvider {
  const config: ModelConfig = {
    provider: 'openai-compatible',
    baseUrl,
    model: 'test-model',
    apiKey: 'test-key',
  };

  return new OpenAICompatibleProvider(config);
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('chatCompletion explains local connection failures with recovery guidance', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  const provider = createProvider('http://localhost:11434/v1');

  await assert.rejects(
    () => provider.chatCompletion({ messages: [], stream: false }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const error = err as Error;
      assert.match(error.message, /Could not reach the local provider/);
      assert.match(error.message, /server is running/);
      assert.match(error.message, /model\.baseUrl is correct/);
      return true;
    }
  );
});

test('chatCompletion explains invalid JSON responses from incompatible endpoints', async () => {
  globalThis.fetch = (async () =>
    new Response('<html>proxy error</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })) as typeof fetch;

  const provider = createProvider('https://example.com/v1');

  await assert.rejects(
    () => provider.chatCompletion({ messages: [], stream: false }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const error = err as Error;
      assert.match(error.message, /Provider returned invalid JSON/);
      assert.match(error.message, /OpenAI-compatible \/chat\/completions endpoint/);
      return true;
    }
  );
});
