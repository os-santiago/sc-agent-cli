import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from './agent.js';
import type { ChatCompletionOptions, ChatCompletionResponse } from './provider.js';
import type { ProjectConfig, StreamDelta } from './types.js';

const config: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
  permissions: {
    autoApprove: ['read_file', 'list_dir', 'search_text'],
  },
};

test('agent quiet mode suppresses tool UI and streams plain content', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sc-agent-agent-'));
  const agent = new Agent({
    workspaceRoot,
    config,
    quiet: true,
  });

  let callCount = 0;
  const fakeProvider = {
    async chatCompletion(
      _options: ChatCompletionOptions,
      onChunk?: (delta: StreamDelta) => void
    ): Promise<ChatCompletionResponse> {
      callCount += 1;

      if (callCount === 1) {
        return {
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'list_dir',
                arguments: '{"path":"."}',
              },
            },
          ],
        };
      }

      onChunk?.({ content: 'done' });
      return { content: 'done' };
    },
  };

  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const logs: string[] = [];
  let stdout = '';

  (agent as unknown as { provider: typeof fakeProvider }).provider = fakeProvider;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;

  try {
    await agent.run('list files and then say done');

    assert.match(stdout, /done$/);
    assert.deepEqual(logs, []);
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
