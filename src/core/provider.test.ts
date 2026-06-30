import * as assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleProvider } from './provider.js';
import type { ModelConfig } from './types.js';

const TEST_CONFIG: ModelConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  model: 'test-model',
};

test('chatCompletion surfaces actionable auth guidance for 401 API errors', async () => {
  const restoreFetch = mockFetch(async () =>
    new Response(JSON.stringify({ error: { message: 'Incorrect API key provided.' } }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    })
  );

  try {
    const provider = new OpenAICompatibleProvider({
      ...TEST_CONFIG,
      baseUrl: 'https://api.openai.com/v1',
    });

    await assert.rejects(
      () => provider.chatCompletion({ messages: [{ role: 'user', content: 'hello' }], stream: false }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const message = err.message;
        assert.match(message, /401 Unauthorized/);
        assert.match(message, /Authentication failed/);
        assert.match(message, /Incorrect API key provided\./);
        return true;
      }
    );
  } finally {
    restoreFetch();
  }
});

test('chatCompletion explains missing OpenAI-compatible endpoint for 404 errors', async () => {
  const restoreFetch = mockFetch(async () =>
    new Response('route not found', {
      status: 404,
      statusText: 'Not Found',
    })
  );

  try {
    const provider = new OpenAICompatibleProvider(TEST_CONFIG);

    await assert.rejects(
      () => provider.chatCompletion({ messages: [{ role: 'user', content: 'hello' }], stream: false }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const message = err.message;
        assert.match(message, /Endpoint not found/);
        assert.match(message, /\/chat\/completions/);
        assert.match(message, /route not found/);
        return true;
      }
    );
  } finally {
    restoreFetch();
  }
});

test('chatCompletion explains connection-refused network failures for local providers', async () => {
  const restoreFetch = mockFetch(async () => {
    throw new TypeError('fetch failed', {
      cause: { code: 'ECONNREFUSED' },
    } as ErrorOptions);
  });

  try {
    const provider = new OpenAICompatibleProvider(TEST_CONFIG);

    await assert.rejects(
      () => provider.chatCompletion({ messages: [{ role: 'user', content: 'hello' }], stream: false }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const message = err.message;
        assert.match(message, /Connection was refused/);
        assert.match(message, /Verify the local provider is running/);
        return true;
      }
    );
  } finally {
    restoreFetch();
  }
});

function mockFetch(implementation: typeof fetch): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
