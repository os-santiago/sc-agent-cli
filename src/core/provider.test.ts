import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';
import type { ModelConfig } from './types.js';

const baseConfig: ModelConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  model: 'test-model',
};

test('chatCompletion surfaces nested API error messages with actionable context', async () => {
  const provider = new OpenAICompatibleProvider(baseConfig);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: 'Invalid API key provided',
        },
      }),
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      }
    );

  try {
    await assert.rejects(
      () => provider.chatCompletion({ messages: [], stream: false }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /API request failed \(401 Unauthorized\)/);
        assert.match(err.message, /Invalid API key provided/);
        assert.match(err.message, /Check that your API key is set correctly/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatCompletion explains provider connectivity failures', async () => {
  const provider = new OpenAICompatibleProvider(baseConfig);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      () => provider.chatCompletion({ messages: [], stream: false }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Could not reach the model provider/);
        assert.match(err.message, /http:\/\/localhost:11434\/v1\/chat\/completions/);
        assert.match(err.message, /Check that the server is running/);
        assert.match(err.message, /Original error: fetch failed/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
