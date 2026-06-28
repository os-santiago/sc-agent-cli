import test from 'node:test';
import assert from 'node:assert/strict';
import { startChatSession } from './chat-session.js';
import { Agent } from '../core/agent.js';
import type { ProjectConfig } from '../core/types.js';

const config: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
};

test('quiet non-interactive mode skips prompt and assistant frames', async () => {
  const originalRun = Agent.prototype.run;
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const logs: string[] = [];
  let stdout = '';

  Agent.prototype.run = async function mockRun() {
    return [];
  };
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;

  try {
    await startChatSession({
      workspaceRoot: process.cwd(),
      config,
      initialPrompt: 'say hello',
      quiet: true,
    });

    assert.deepEqual(logs, []);
    assert.equal(stdout, '\n');
  } finally {
    Agent.prototype.run = originalRun;
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
});
