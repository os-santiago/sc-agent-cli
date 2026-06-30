import test from 'node:test';
import assert from 'node:assert/strict';
import { switchChatModelProfile } from './chat-session.js';
import type { ProjectConfig } from '../core/types.js';

function createConfig(): ProjectConfig {
  return {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      apiKey: 'local-key',
      temperature: 0.7,
      maxTokens: 4096,
    },
    profiles: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        apiKey: 'profile-key',
        temperature: 0.2,
      },
    },
    activeProfile: 'ollama',
  };
}

test('switchChatModelProfile updates model settings and persists the selected profile', async () => {
  const config = createConfig();
  const saved: ProjectConfig[] = [];

  const updated = await switchChatModelProfile(
    config,
    'openai',
    async (nextConfig) => {
      saved.push(structuredClone(nextConfig));
    },
    {}
  );

  assert.equal(updated.activeProfile, 'openai');
  assert.equal(updated.model.baseUrl, 'https://api.openai.com/v1');
  assert.equal(updated.model.model, 'gpt-4o');
  assert.equal(updated.model.apiKey, 'profile-key');
  assert.equal(updated.model.temperature, 0.2);

  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.activeProfile, 'openai');
  assert.equal(saved[0]?.model.model, 'gpt-4o');
});

test('switchChatModelProfile keeps environment API keys as highest priority', async () => {
  const config = createConfig();

  const updated = await switchChatModelProfile(
    config,
    'openai',
    async () => {},
    { OPENAI_API_KEY: 'env-key' }
  );

  assert.equal(updated.model.apiKey, 'env-key');
});
