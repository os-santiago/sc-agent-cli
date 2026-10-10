import { test, vi, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from './provider.js';
import type { ModelConfig } from './types.js';

// Real failover classes, fake backoff — tests assert the retry bound,
// not wall-clock pacing.
vi.mock('./failover.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./failover.js')>();
  return { ...mod, computeRetryDelay: () => 1 };
});

// The fetch spy is shared across tests — restore it per test so
// mock.calls[0] is this test's request, not a stale earlier one.
afterEach(() => {
  vi.restoreAllMocks();
});

function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    provider: 'openai-compatible',
    baseUrl: 'http://test.api/v1',
    model: 'test-model',
    ...overrides,
  };
}

function sseEvent(data: string): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function sseDelta(delta: Record<string, unknown>, finish?: string): string {
  const choice: Record<string, unknown> = { index: 0, delta };
  if (finish) choice.finish_reason = finish;
  const obj = { id: 'test-id', object: 'chat.completion.chunk', choices: [choice] };
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseToolCallDelta(toolCall: Record<string, unknown>): string {
  const obj = {
    id: 'test-id',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [toolCall] } }],
  };
  return `data: ${JSON.stringify(obj)}\n\n`;
}

test('chatCompletion returns text content from non-streaming response', async () => {
  const mockResponse = {
    ok: true,
    json: () => Promise.resolve({
      choices: [{ message: { content: 'Hello, world!' } }],
    }),
  };
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  });

  assert.equal(result.content, 'Hello, world!');
  assert.equal(result.tool_calls, undefined);
});

test('chatCompletion handles streaming response with content', async () => {
  const chunks = [
    sseDelta({ role: 'assistant', content: 'Hello' }),
    sseDelta({ content: ' world' }),
    sseDelta({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: stream,
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.content, 'Hello world');
});

test('chatCompletion streams accumulate tool calls', async () => {
  const chunks = [
    sseDelta({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '' } }] }),
    sseDelta({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
    sseDelta({ tool_calls: [{ index: 0, function: { arguments: '"test.txt"}' } }] }),
    sseDelta({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: stream,
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'read file' }],
    stream: true,
  });

  assert.ok(result.tool_calls);
  assert.equal(result.tool_calls.length, 1);
  assert.equal(result.tool_calls[0].function.name, 'read_file');
  assert.equal(result.tool_calls[0].function.arguments, '{"path":"test.txt"}');
});

test('chatCompletion emits deltas via onChunk callback', async () => {
  const chunks = [
    sseDelta({ role: 'assistant', content: 'Hello' }),
    sseDelta({ content: ' world' }),
    'data: [DONE]\n\n',
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: stream,
  } as any);

  const deltas: string[] = [];
  const provider = new OpenAICompatibleProvider(makeConfig());
  await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  }, (delta) => {
    if (delta.content) deltas.push(delta.content);
  });

  assert.deepEqual(deltas, ['Hello', ' world']);
});

test('chatCompletion handles SSE data split across TCP chunks', async () => {
  // Split a proper API response format across TCP chunks
  const first = 'data: {"id":"x","choices":[{"index":0,"delta":{"content":"hel';
  const second = 'lo"}}]}\n\n';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(first));
      controller.enqueue(encoder.encode(second));
      controller.close();
    },
  });

  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: stream,
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.content, 'hello');
});

test('chatCompletion throws on non-OK response', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: false,
    status: 401,
    text: () => Promise.resolve('Unauthorized'),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  await assert.rejects(
    () => provider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    /API Error 401/
  );
});

test('chatCompletion handles streaming=false without body gracefully', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: null,
    json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig({ stream: false }));
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  });
  assert.equal(result.content, '');
});

test('chatCompletion surfaces usage from a non-streamed response (#424)', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      choices: [{ message: { content: 'done' } }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 12 },
      },
    }),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  });

  assert.equal(result.usage?.prompt_tokens, 120);
  assert.equal(result.usage?.completion_tokens, 30);
  assert.equal(result.usage?.prompt_tokens_details?.cached_tokens, 12);
});

test('chatCompletion requests stream_options.include_usage and captures the usage chunk (#424)', async () => {
  const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } })}\n\n`;
  const chunks = [
    sseDelta({ role: 'assistant', content: 'ok' }),
    sseDelta({ content: '' }, 'stop'),
    usageChunk,
    'data: [DONE]\n\n',
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: stream,
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(result.content, 'ok');
  assert.equal(result.usage?.prompt_tokens, 9);
  assert.equal(result.usage?.completion_tokens, 4);
});

test('chatCompletion does not send stream_options for non-streamed requests', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content: 'x' } }] }),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  await provider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }], stream: false });

  const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
  assert.equal(body.stream_options, undefined);
});

test('chatCompletion retries on 429 with backoff', async () => {
  let callCount = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    callCount++;
    if (callCount < 3) {
      return { ok: false, status: 429, text: () => Promise.resolve('Rate limited') } as any;
    }
    return { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }) } as any;
  });

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  });

  assert.equal(callCount, 3);
  assert.equal(result.content, 'ok');
});

// --- Non-canonical wire shapes (#533) ---
// Failure signature scc:zero-mutations:devin/swe-2-high. Shims over
// non-OpenAI protocols (devin/swe-2-class gateways, Anthropic adapters,
// llama.cpp) relay tool invocations in shapes the strict parser dropped:
// a non-array payload threw inside processChunk and killed every call in
// the chunk, index-less calls all collapsed into one slot, and
// `function_call`/`message`/content-part channels were ignored entirely.
// Every path below ended a turn with zero mutations.

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test('chatCompletion streams index-less tool_calls as separate calls (no undefined-slot collapse)', async () => {
  const chunks = [
    sseDelta({
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
        { id: 'call-2', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } },
      ],
    }),
    sseDelta({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
  ];
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, body: streamOf(chunks) } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.tool_calls?.length, 2);
  assert.equal(result.tool_calls?.[0].function.name, 'read_file');
  assert.equal(result.tool_calls?.[1].function.name, 'list_dir');
  assert.equal(result.tool_calls?.[0].function.arguments, '{"path":"a.ts"}');
});

test('chatCompletion merges index-less args-only fragments into the preceding call', async () => {
  const chunks = [
    sseDelta({ tool_calls: [{ id: 'call-1', function: { name: 'write_file' } }] }),
    sseDelta({ tool_calls: [{ function: { arguments: '{"path"' } }] }),
    sseDelta({ tool_calls: [{ function: { arguments: ':"a.ts"}' } }] }),
    sseDelta({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
  ];
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, body: streamOf(chunks) } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].function.name, 'write_file');
  assert.equal(result.tool_calls?.[0].function.arguments, '{"path":"a.ts"}');
});

test('chatCompletion accepts a non-array tool_calls payload instead of dropping the chunk', async () => {
  const chunks = [
    sseDelta({
      tool_calls: { id: 'call-1', type: 'function', function: { name: 'run_shell', arguments: '{"command":"ls"}' } },
    }),
    sseDelta({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
  ];
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, body: streamOf(chunks) } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].function.name, 'run_shell');
  assert.equal(result.tool_calls?.[0].function.arguments, '{"command":"ls"}');
});

test('chatCompletion recovers the legacy function_call field', async () => {
  const chunks = [
    sseDelta({ function_call: { name: 'search_text', arguments: '{"pattern":"TODO"}' } }),
    sseDelta({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
  ];
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, body: streamOf(chunks) } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].function.name, 'search_text');
  assert.equal(result.tool_calls?.[0].function.arguments, '{"pattern":"TODO"}');
});

test('chatCompletion accepts message-shaped chunks inside an SSE stream', async () => {
  const chunk = {
    id: 'chatcmpl-x',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
          ],
        },
      },
    ],
  };
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: streamOf([`data: ${JSON.stringify(chunk)}\n\n`, 'data: [DONE]\n\n']),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].function.name, 'read_file');
});

test('chatCompletion recovers tool_use blocks from array content parts', async () => {
  const chunks = [
    sseDelta({
      content: [
        { type: 'text', text: 'Let me read it.' },
        { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } },
      ],
    }),
    sseDelta({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
  ];
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, body: streamOf(chunks) } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.content, 'Let me read it.');
  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].function.name, 'read_file');
  assert.equal(result.tool_calls?.[0].function.arguments, '{"path":"a.ts"}');
});

test('chatCompletion does not double-count a re-sent completed call', async () => {
  const frame = sseDelta({
    tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    body: streamOf([frame, frame, sseDelta({ content: '' }, 'stop'), 'data: [DONE]\n\n']),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });

  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].function.arguments, '{"path":"a.ts"}');
});

test('chatCompletion non-streamed normalizes non-canonical tool_calls shapes', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      choices: [
        {
          message: {
            content: null,
            // single object, not an array; arguments as an object
            tool_calls: { id: 'call-1', function: { name: 'write_file', arguments: { path: 'a.ts', content: 'x' } } },
          },
        },
      ],
    }),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  });

  assert.equal(result.tool_calls?.length, 1);
  assert.equal(result.tool_calls?.[0].function.name, 'write_file');
  assert.equal(result.tool_calls?.[0].function.arguments, '{"path":"a.ts","content":"x"}');
});

test('chatCompletion non-streamed recovers function_call and array content parts', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'Reading the file.' },
              { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } },
            ],
            function_call: { name: 'list_dir', arguments: { path: '.' } },
          },
        },
      ],
    }),
  } as any);

  const provider = new OpenAICompatibleProvider(makeConfig());
  const result = await provider.chatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  });

  assert.equal(result.content, 'Reading the file.');
  assert.equal(result.tool_calls?.length, 2);
  const names = result.tool_calls!.map((tc) => tc.function.name).sort();
  assert.deepEqual(names, ['list_dir', 'read_file']);
  const read = result.tool_calls!.find((tc) => tc.function.name === 'read_file')!;
  assert.equal(read.function.arguments, '{"path":"a.ts"}');
});
