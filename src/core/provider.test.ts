import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';

const TEST_CONFIG = {
  provider: 'openai-compatible' as const,
  baseUrl: 'http://localhost:11434/v1',
  model: 'test-model',
};

test('chatCompletion surfaces actionable network guidance', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const provider = new OpenAICompatibleProvider(TEST_CONFIG);

  await assert.rejects(
    () => provider.chatCompletion({ messages: [], stream: false }),
    /Could not reach provider at http:\/\/localhost:11434\/v1\/chat\/completions\. Check that the base URL is correct, the provider is running, and your network connection is available\. Original error: fetch failed/
  );

  globalThis.fetch = originalFetch;
});

test('chatCompletion explains missing API path on 404 errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'unknown path' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });

  const provider = new OpenAICompatibleProvider(TEST_CONFIG);

  await assert.rejects(
    () => provider.chatCompletion({ messages: [], stream: false }),
    /Provider endpoint not found \(404\) at http:\/\/localhost:11434\/v1\/chat\/completions\. Verify the base URL and make sure it includes the correct API path such as \/v1\. Provider message: unknown path/
  );

  globalThis.fetch = originalFetch;
});
