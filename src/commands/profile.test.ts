import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectConfig } from '../core/types.js';
import {
  resetProfileCommandDepsForTesting,
  setProfileCommandDepsForTesting,
  removeProfile,
  useProfile,
} from './profile.js';

function createConfig(): ProjectConfig {
  return {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    },
    activeProfile: 'ollama',
    profiles: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
    },
  };
}

test.afterEach(() => {
  resetProfileCommandDepsForTesting();
  mock.restoreAll();
});

test('useProfile treats a cancelled selection as a cancellation', async () => {
  const config = createConfig();
  let saveCalled = false;
  const logs: string[] = [];

  setProfileCommandDepsForTesting({
    loadConfig: async () => config,
    saveConfig: async () => {
      saveCalled = true;
    },
    prompts: async () => ({ profile: undefined }),
  });

  mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  await useProfile();

  assert.equal(saveCalled, false);
  assert.equal(config.activeProfile, 'ollama');
  assert.ok(logs.some((line) => line.includes('Profile selection cancelled')));
  assert.ok(logs.every((line) => !line.includes('Profile name is required')));
});

test('removeProfile treats a cancelled selection as a cancellation', async () => {
  const config = createConfig();
  let saveCalled = false;
  const logs: string[] = [];

  setProfileCommandDepsForTesting({
    loadConfig: async () => config,
    saveConfig: async () => {
      saveCalled = true;
    },
    prompts: async () => ({ profile: undefined }),
  });

  mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  await removeProfile();

  assert.equal(saveCalled, false);
  assert.ok(config.profiles?.ollama);
  assert.equal(config.activeProfile, 'ollama');
  assert.ok(logs.some((line) => line.includes('Profile removal cancelled')));
  assert.ok(logs.every((line) => !line.includes('Profile name is required')));
});
