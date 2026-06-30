import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addProfileWithDeps,
  type ProfileCommandDeps,
  removeProfileWithDeps,
  useProfileWithDeps,
} from './profile.js';
import type { ProjectConfig } from '../core/types.js';

function createConfig(): ProjectConfig {
  return {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    },
    profiles: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
    },
    activeProfile: 'ollama',
  };
}

function createPromptStub(responses: unknown[]) {
  let index = 0;
  return async () => responses[index++] ?? {};
}

function createDeps(config: ProjectConfig, responses: unknown[]) {
  const logs: string[] = [];
  let saveCalls = 0;

  return {
    deps: {
      loadConfig: async () => structuredClone(config),
      saveConfig: async () => {
        saveCalls += 1;
      },
      prompt: createPromptStub(responses) as unknown as ProfileCommandDeps['prompt'],
      log: (message?: unknown) => {
        logs.push(String(message ?? ''));
      },
    },
    logs,
    getSaveCalls: () => saveCalls,
  };
}

test('addProfile reports cancellation instead of requiring a name', async () => {
  const { deps, logs, getSaveCalls } = createDeps(createConfig(), [{}]);

  await addProfileWithDeps(undefined, deps);

  assert.equal(getSaveCalls(), 0);
  assert.equal(logs.some((entry) => entry.includes('Profile creation cancelled')), true);
  assert.equal(logs.some((entry) => entry.includes('Profile name is required')), false);
});

test('addProfile does not save a partial profile when setup is cancelled', async () => {
  const { deps, logs, getSaveCalls } = createDeps(createConfig(), [{ baseUrl: undefined, model: undefined }]);

  await addProfileWithDeps('demo', deps);

  assert.equal(getSaveCalls(), 0);
  assert.equal(logs.some((entry) => entry.includes('was not saved because setup was cancelled')), true);
});

test('useProfile reports selector cancellation without saving config', async () => {
  const { deps, logs, getSaveCalls } = createDeps(createConfig(), [{}]);

  await useProfileWithDeps(undefined, deps);

  assert.equal(getSaveCalls(), 0);
  assert.equal(logs.some((entry) => entry.includes('Profile switch cancelled')), true);
  assert.equal(logs.some((entry) => entry.includes('Profile name is required')), false);
});

test('removeProfile reports selector cancellation without saving config', async () => {
  const { deps, logs, getSaveCalls } = createDeps(createConfig(), [{}]);

  await removeProfileWithDeps(undefined, deps);

  assert.equal(getSaveCalls(), 0);
  assert.equal(logs.some((entry) => entry.includes('Profile removal cancelled')), true);
  assert.equal(logs.some((entry) => entry.includes('Profile name is required')), false);
});
