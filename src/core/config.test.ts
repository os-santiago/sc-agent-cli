import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initConfig, loadConfig, validateConfig } from './config.js';
import type { ProjectConfig } from './types.js';

function createConfig(baseUrl: string, apiKey?: string): ProjectConfig {
  return {
    model: {
      provider: 'openai-compatible',
      baseUrl,
      model: 'test-model',
      apiKey,
    },
  };
}

test('validateConfig explains missing OpenAI API key', () => {
  assert.throws(
    () => validateConfig(createConfig('https://api.openai.com/v1')),
    /OpenAI API requires an API key\. Set model\.apiKey in config, OPENAI_API_KEY, or SC_API_KEY\./
  );
});

test('validateConfig explains missing Anthropic API key', () => {
  assert.throws(
    () => validateConfig(createConfig('https://api.anthropic.com/v1')),
    /Anthropic API requires an API key\. Set model\.apiKey in config, ANTHROPIC_API_KEY, or SC_API_KEY\./
  );
});

test('validateConfig explains missing NVIDIA API key', () => {
  assert.throws(
    () => validateConfig(createConfig('https://integrate.api.nvidia.com/v1')),
    /NVIDIA API requires an API key\. Set model\.apiKey in config, NVIDIA_API_KEY, or SC_API_KEY\./
  );
});

test('validateConfig allows known remote providers when apiKey is present', () => {
  assert.doesNotThrow(() => validateConfig(createConfig('https://api.openai.com/v1', 'test-key')));
  assert.doesNotThrow(() => validateConfig(createConfig('https://api.anthropic.com/v1', 'test-key')));
  assert.doesNotThrow(() => validateConfig(createConfig('https://integrate.api.nvidia.com/v1', 'test-key')));
});

test('validateConfig does not require apiKey for local OpenAI-compatible providers', () => {
  assert.doesNotThrow(() => validateConfig(createConfig('http://localhost:11434/v1')));
});

test('loadConfig surfaces invalid project config JSON with file path and recovery hint', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-'));
  const projectConfigPath = path.join(projectRoot, '.sc-agent.json');

  await writeFile(projectConfigPath, '{"model":', 'utf-8');

  await assert.rejects(
    () => loadConfig(projectRoot),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Invalid JSON in project config/);
      assert.match(err.message, new RegExp(escapeRegex(projectConfigPath)));
      assert.match(err.message, /sc config-init/);
      return true;
    }
  );
});

test('initConfig refuses to overwrite an existing global config without --force', async () => {
  await withTempHome(async (homeDir) => {
    const configDir = path.join(homeDir, '.sc-agent');
    const configPath = path.join(configDir, 'config.json');

    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, '{"model":{"baseUrl":"https://example.com","model":"custom"}}', 'utf-8');

    await assert.rejects(
      () => initConfig(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Global config already exists/);
        assert.match(err.message, new RegExp(escapeRegex(configPath)));
        assert.match(err.message, /sc config-init --force/);
        return true;
      }
    );
  });
});

test('initConfig overwrites an existing global config when --force is used', async () => {
  await withTempHome(async (homeDir) => {
    const configDir = path.join(homeDir, '.sc-agent');
    const configPath = path.join(configDir, 'config.json');

    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, '{"model":{"baseUrl":"https://example.com","model":"custom"}}', 'utf-8');

    await initConfig(true);

    const savedConfig = JSON.parse(await readFile(configPath, 'utf-8')) as ProjectConfig;
    assert.equal(savedConfig.model.baseUrl, 'http://localhost:11434/v1');
    assert.equal(savedConfig.activeProfile, 'ollama');
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function withTempHome(run: (homeDir: string) => Promise<void>): Promise<void> {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await run(homeDir);
  } finally {
    restoreEnvVar('HOME', previousHome);
    restoreEnvVar('USERPROFILE', previousUserProfile);
  }
}

function restoreEnvVar(name: 'HOME' | 'USERPROFILE', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
