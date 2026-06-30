import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listProfiles, useProfile } from './profile.js';

test('useProfile can recover from a broken active profile without API keys', async () => {
  await withTempConfig(
    {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      profiles: {
        broken: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        },
        safe: {
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.2',
        },
      },
      activeProfile: 'broken',
    },
    async (configPath) => {
      await assert.doesNotReject(() => useProfile('safe'));

      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8')) as {
        activeProfile?: string;
      };

      assert.equal(savedConfig.activeProfile, 'safe');
    }
  );
});

test('listProfiles still works when the active profile is invalid', async () => {
  await withTempConfig(
    {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      profiles: {
        broken: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        },
      },
      activeProfile: 'broken',
    },
    async () => {
      await assert.doesNotReject(() => listProfiles());
    }
  );
});

async function withTempConfig(
  config: object,
  run: (configPath: string) => Promise<void>
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-profile-'));
  const homeDir = path.join(tempRoot, 'home');
  const configDir = path.join(homeDir, '.sc-agent');
  const configPath = path.join(configDir, 'config.json');
  const originalUserProfile = process.env.USERPROFILE;
  const originalHome = process.env.HOME;
  const originalScApiKey = process.env.SC_API_KEY;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const originalNvidiaApiKey = process.env.NVIDIA_API_KEY;

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

  process.env.USERPROFILE = homeDir;
  process.env.HOME = homeDir;
  delete process.env.SC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NVIDIA_API_KEY;

  try {
    await run(configPath);
  } finally {
    restoreEnv('USERPROFILE', originalUserProfile);
    restoreEnv('HOME', originalHome);
    restoreEnv('SC_API_KEY', originalScApiKey);
    restoreEnv('OPENAI_API_KEY', originalOpenAiApiKey);
    restoreEnv('ANTHROPIC_API_KEY', originalAnthropicApiKey);
    restoreEnv('NVIDIA_API_KEY', originalNvidiaApiKey);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
