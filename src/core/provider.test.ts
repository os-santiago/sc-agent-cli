import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';
import type { Message, ModelConfig } from './types.js';

const config: ModelConfig = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.example.test/v1',
  model: 'demo-model',
};

const messages: Message[] = [
  { role: 'user', content: 'Hello' },
];

test('chatCompletion surfaces actionable guidance for 401 API responses', async () => {
  const provider = new OpenAICompatibleProvider(config);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Invalid API key' } }),
    {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    }
  );

  try {
    await assert.rejects(
      () => provider.chatCompletion({ messages, stream: false }),
      /API request failed \(401 Unauthorized\): Invalid API key\. Verify the API key for the active profile or set SC_API_KEY before retrying\./
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatCompletion rewrites fetch connectivity failures with endpoint guidance', async () => {
  const provider = new OpenAICompatibleProvider(config);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      () => provider.chatCompletion({ messages, stream: false }),
      /Could not reach model endpoint at https:\/\/api\.example\.test\/v1\/chat\/completions: fetch failed\. Check the base URL, provider availability, and network connection\./
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
