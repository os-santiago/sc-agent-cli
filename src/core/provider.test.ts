import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';
import type { ModelConfig } from './types.js';

const TEST_CONFIG: ModelConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.2',
};

test('chatCompletion explains when provider returns no completion choices', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const provider = new OpenAICompatibleProvider(TEST_CONFIG);

    await assert.rejects(
      () => provider.chatCompletion({ messages: [], stream: false }),
      /Provider returned no completion choices.*supports the OpenAI-compatible \/chat\/completions format/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatCompletion explains when provider returns invalid JSON', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const provider = new OpenAICompatibleProvider(TEST_CONFIG);

    await assert.rejects(
      () => provider.chatCompletion({ messages: [], stream: false }),
      /Provider returned invalid JSON from http:\/\/localhost:11434\/v1\/chat\/completions/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
