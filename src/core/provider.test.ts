import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';
import type { ModelConfig } from './types.js';

const baseConfig: ModelConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1',
  model: 'test-model',
};

test('chatCompletion reports network failures with endpoint context', async () => {
  const provider = new OpenAICompatibleProvider(baseConfig);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      provider.chatCompletion({
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      }),
      /Network error while reaching http:\/\/localhost:1234\/v1\/chat\/completions: fetch failed/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatCompletion extracts concise API error messages from JSON payloads', async () => {
  const provider = new OpenAICompatibleProvider(baseConfig);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid API key provided' } }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    await assert.rejects(
      provider.chatCompletion({
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
      }),
      /API Error 401 Unauthorized: Invalid API key provided/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
