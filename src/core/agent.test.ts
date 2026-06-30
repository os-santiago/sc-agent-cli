import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent } from './agent.js';
import type { ChatCompletionOptions, ChatCompletionResponse } from './provider.js';
import type { StreamDelta } from './types.js';

test('quiet mode writes streamed content without decorative framing', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-quiet-'));
  await writeFile(path.join(workspaceRoot, 'AGENTS.md'), 'Project context', 'utf-8');

  const agent = new Agent({
    workspaceRoot,
    quiet: true,
    config: {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'test-model',
      },
    },
  });

  (agent as unknown as {
    provider: {
      chatCompletion: (
        options: ChatCompletionOptions,
        onChunk?: (delta: StreamDelta) => void
      ) => Promise<ChatCompletionResponse>;
    };
  }).provider = {
    async chatCompletion(_options, onChunk) {
      onChunk?.({ content: 'Hello' });
      onChunk?.({ content: ' world' });
      return { content: 'Hello world' };
    },
  };

  let stdout = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;

  try {
    const history = await agent.run('Say hello');
    assert.equal(history.at(-1)?.content, 'Hello world');
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(stdout, 'Hello world');
});
