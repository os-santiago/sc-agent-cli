import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectConfig } from '../core/types.js';
import { clearSessionPermissions, requestPermission } from './permissions.js';

const TEST_CONFIG: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
  permissions: {
    autoApprove: [],
    denyPaths: [],
    profile: 'traditional',
  },
};

test('requestPermission shows the run_shell tip only once per session', async () => {
  clearSessionPermissions();
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };

  try {
    const ctx = {
      toolName: 'run_shell',
      args: { command: 'npm test' },
      config: TEST_CONFIG,
    } as const;

    await requestPermission(ctx, {
      prompt: async () => ({ choice: 'yes' }),
    });

    const firstPromptOutput = output.join('\n');
    assert.match(firstPromptOutput, /sc chat -y/);

    output.length = 0;

    await requestPermission(ctx, {
      prompt: async () => ({ choice: 'yes' }),
    });

    assert.doesNotMatch(output.join('\n'), /sc chat -y/);
  } finally {
    console.log = originalLog;
    clearSessionPermissions();
  }
});

test('requestPermission explains how file-write approvals can persist', async () => {
  clearSessionPermissions();
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };

  try {
    await requestPermission(
      {
        toolName: 'write_file',
        args: { path: 'notes.txt' },
        config: TEST_CONFIG,
      },
      {
        prompt: async () => ({ choice: 'yes' }),
      }
    );

    assert.match(output.join('\n'), /permissions\.autoApprove/);
    assert.match(output.join('\n'), /Choose "Always"/);
  } finally {
    console.log = originalLog;
    clearSessionPermissions();
  }
});
