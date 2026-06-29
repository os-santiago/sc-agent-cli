import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../core/agent.js';
import { startChatSession } from './chat-session.js';
import type { Message, ProjectConfig } from '../core/types.js';

test('quiet non-interactive mode omits assistant frames', async () => {
  const originalLog = console.log;
  const originalRun = Agent.prototype.run;
  const captured: string[] = [];

  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };

  Agent.prototype.run = async function mockRun(_input: string, history: Message[]): Promise<Message[]> {
    console.log('stub response');
    return history;
  };

  const config: ProjectConfig = {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'test-model',
    },
  };

  try {
    await startChatSession({
      workspaceRoot: process.cwd(),
      config,
      autoApprove: false,
      initialPrompt: 'hello',
      quiet: true,
    });
  } finally {
    console.log = originalLog;
    Agent.prototype.run = originalRun;
  }

  const output = captured.join('\n');
  assert.match(output, /stub response/);
  assert.doesNotMatch(output, /Assistant/);
  assert.doesNotMatch(output, /┌─/);
  assert.doesNotMatch(output, /└─/);
});
