import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent } from './agent.js';
import type { ProjectConfig, StreamDelta } from './types.js';

const testConfig: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'test-model',
  },
};

test('Agent quiet mode suppresses streamed output and status logs', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-quiet-'));
  const agent = new Agent({
    workspaceRoot,
    config: testConfig,
    autoApprove: false,
    quiet: true,
  });

  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const logged: string[] = [];
  const written: string[] = [];

  console.log = (message?: unknown, ...args: unknown[]) => {
    logged.push([message, ...args].map((value) => String(value)).join(' '));
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    return true;
  }) as typeof process.stdout.write;

  try {
    const agentWithProvider = agent as unknown as {
      provider: {
        chatCompletion: (
          options: unknown,
          onChunk?: (delta: StreamDelta) => void
        ) => Promise<{content: string}>;
      };
    };

    agentWithProvider.provider = {
      chatCompletion: async (_options: unknown, onChunk?: (delta: StreamDelta) => void) => {
        onChunk?.({ content: 'quiet response' });
        return { content: 'quiet response' };
      },
    };

    const history = await agent.run('hello');

    assert.equal(history.at(-1)?.content, 'quiet response');
    assert.deepEqual(logged, []);
    assert.deepEqual(written, []);
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
});
