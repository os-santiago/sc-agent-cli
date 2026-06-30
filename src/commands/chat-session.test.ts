import test from 'node:test';
import assert from 'node:assert/strict';
import { startChatSession } from './chat-session.js';
import { Agent } from '../core/agent.js';
import type { AgentOptions } from '../core/agent.js';

function createOptions(overrides: Partial<AgentOptions> = {}): AgentOptions {
  return {
    workspaceRoot: process.cwd(),
    config: {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'test-model',
      },
    },
    ...overrides,
  };
}

test('startChatSession keeps quiet non-interactive output free of assistant framing', async () => {
  const originalRun = Agent.prototype.run;
  const originalLog = console.log;
  const logs: string[] = [];

  Agent.prototype.run = async function mockRun() {
    return [];
  };
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  };

  try {
    await startChatSession(createOptions({
      initialPrompt: 'say hello',
      quiet: true,
    }));
  } finally {
    Agent.prototype.run = originalRun;
    console.log = originalLog;
  }

  assert.deepEqual(logs, []);
});
