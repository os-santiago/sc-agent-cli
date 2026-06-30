import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';

test('chatCompletion processes the final SSE chunk without a trailing newline', async () => {
  const provider = new OpenAICompatibleProvider({
    provider: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"Hello"}}]}\n' +
              'data: {"choices":[{"delta":{"content":" world"}}]}'
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );

  try {
    const response = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    assert.equal(response.content, 'Hello world');
    assert.equal(response.tool_calls, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatCompletion fills a streamed tool call id when it arrives after the first delta', async () => {
  const provider = new OpenAICompatibleProvider({
    provider: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file","arguments":"{\\"path\\":\\"REA"}}]}}]}\n' +
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","function":{"arguments":"DME.md\\"}"}}]}}]}\n' +
              'data: [DONE]\n'
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    );

  try {
    const response = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'open the readme' }],
      stream: true,
    });

    assert.deepEqual(response.tool_calls, [
      {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
