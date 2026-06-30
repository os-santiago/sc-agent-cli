import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, validateConfig, initConfig } from './config.js';
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
  const configDir = path.join(homedir(), '.sc-agent');
  const configPath = path.join(configDir, 'config.json');
  const backupPath = path.join(configDir, `config.backup-${Date.now()}.json`);
  const hadOriginalConfig = await renameIfExists(configPath, backupPath);

  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, '{"model":{"baseUrl":"https://example.com","model":"custom"}}', 'utf-8');

    await assert.rejects(
      () => initConfig(),
      /Config already exists .*sc config-init --force/
    );

    const persisted = await readFile(configPath, 'utf-8');
    assert.equal(persisted, '{"model":{"baseUrl":"https://example.com","model":"custom"}}');
  } finally {
    await restoreBackup(configPath, backupPath, hadOriginalConfig);
  }
});

test('initConfig overwrites an existing global config when --force is used', async () => {
  const configDir = path.join(homedir(), '.sc-agent');
  const configPath = path.join(configDir, 'config.json');
  const backupPath = path.join(configDir, `config.backup-${Date.now()}-force.json`);
  const hadOriginalConfig = await renameIfExists(configPath, backupPath);

  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, '{"model":{"baseUrl":"https://example.com","model":"custom"}}', 'utf-8');

    await initConfig(true);

    const persisted = await readFile(configPath, 'utf-8');
    assert.match(persisted, /"activeProfile": "ollama"/);
    assert.match(persisted, /"baseUrl": "http:\/\/localhost:11434\/v1"/);
  } finally {
    await restoreBackup(configPath, backupPath, hadOriginalConfig);
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function renameIfExists(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    await readFile(sourcePath, 'utf-8');
    await rename(sourcePath, targetPath);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw err;
  }
}

async function restoreBackup(configPath: string, backupPath: string, hadOriginalConfig: boolean): Promise<void> {
  try {
    await rm(configPath, { force: true });
  } finally {
    if (hadOriginalConfig) {
      await rename(backupPath, configPath);
    }
  }
}
