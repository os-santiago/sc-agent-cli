import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';

test('chatCompletion preserves tool call ids that arrive in later stream chunks', async () => {
  const originalFetch = globalThis.fetch;

  const streamBody = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","function":{"arguments":"{\\"city\\":\\"Paris\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ];

  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of streamBody) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      }),
      { status: 200 }
    );

  try {
    const provider = new OpenAICompatibleProvider({
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
    });

    const response = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'Weather?' }],
      stream: true,
    });

    assert.deepEqual(response.tool_calls, [
      {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Paris"}',
        },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
