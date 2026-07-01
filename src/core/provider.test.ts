import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';
import type { Message, ModelConfig } from './types.js';

const ORIGINAL_FETCH = globalThis.fetch;

function createProvider(baseUrl: string): OpenAICompatibleProvider {
  const config: ModelConfig = {
    provider: 'openai-compatible',
    baseUrl,
    model: 'test-model',
  };

  return new OpenAICompatibleProvider(config);
}

function createMessages(): Message[] {
  return [{ role: 'user', content: 'Hello' }];
}

test('chatCompletion explains local provider connection failures', async (t) => {
  t.after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  globalThis.fetch = async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
    });
    throw new TypeError('fetch failed', { cause });
  };

  const provider = createProvider('http://localhost:11434/v1');

  await assert.rejects(
    () => provider.chatCompletion({ messages: createMessages(), stream: false }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Could not reach local provider at http:\/\/localhost:11434\./);
      assert.match(err.message, /Check that the server is running and the configured base URL is correct\./);
      assert.match(err.message, /ECONNREFUSED/);
      return true;
    }
  );
});

test('chatCompletion explains remote provider DNS failures', async (t) => {
  t.after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  globalThis.fetch = async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), {
      code: 'ENOTFOUND',
    });
    throw new TypeError('fetch failed', { cause });
  };

  const provider = createProvider('https://api.example.com/v1');

  await assert.rejects(
    () => provider.chatCompletion({ messages: createMessages(), stream: false }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Could not reach provider at https:\/\/api\.example\.com\./);
      assert.match(err.message, /Check your internet connection, provider status, and configured base URL\./);
      assert.match(err.message, /ENOTFOUND/);
      return true;
    }
  );
});

test('chatCompletion preserves API status errors from the provider', async (t) => {
  t.after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  globalThis.fetch = async () => new Response('bad api key', { status: 401, statusText: 'Unauthorized' });

  const provider = createProvider('https://api.example.com/v1');

  await assert.rejects(
    () => provider.chatCompletion({ messages: createMessages(), stream: false }),
    /API Error 401: bad api key/
  );
});
