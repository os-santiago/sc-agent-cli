import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, validateConfig } from './config.js';
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

test('loadConfig prefers the provider-specific env var for the active provider', { concurrency: false }, async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousScKey = process.env.SC_API_KEY;

  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  delete process.env.SC_API_KEY;

  try {
    const config = await loadConfig();
    assert.equal(config.model.apiKey, undefined);

    const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-env-'));
    await writeFile(
      path.join(projectRoot, '.sc-agent.json'),
      JSON.stringify({
        activeProfile: '',
        model: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
        },
      }),
      'utf-8'
    );

    const projectConfig = await loadConfig(projectRoot);
    assert.equal(projectConfig.model.apiKey, 'openai-test-key');
  } finally {
    restoreEnvVar('OPENAI_API_KEY', previousOpenAiKey);
    restoreEnvVar('ANTHROPIC_API_KEY', previousAnthropicKey);
    restoreEnvVar('SC_API_KEY', previousScKey);
  }
});

test('loadConfig ignores unrelated provider env vars for custom OpenAI-compatible endpoints', { concurrency: false }, async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousScKey = process.env.SC_API_KEY;

  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  delete process.env.SC_API_KEY;

  try {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-custom-env-'));
    await writeFile(
      path.join(projectRoot, '.sc-agent.json'),
      JSON.stringify({
        activeProfile: '',
        model: {
          baseUrl: 'https://llm.example.com/v1',
          model: 'custom-model',
        },
      }),
      'utf-8'
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.model.apiKey, undefined);
  } finally {
    restoreEnvVar('OPENAI_API_KEY', previousOpenAiKey);
    restoreEnvVar('ANTHROPIC_API_KEY', previousAnthropicKey);
    restoreEnvVar('SC_API_KEY', previousScKey);
  }
});

test('loadConfig lets SC_API_KEY override provider-specific env vars', { concurrency: false }, async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousScKey = process.env.SC_API_KEY;

  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.SC_API_KEY = 'sc-test-key';

  try {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-sc-key-'));
    await writeFile(
      path.join(projectRoot, '.sc-agent.json'),
      JSON.stringify({
        activeProfile: '',
        model: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
        },
      }),
      'utf-8'
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.model.apiKey, 'sc-test-key');
  } finally {
    restoreEnvVar('OPENAI_API_KEY', previousOpenAiKey);
    restoreEnvVar('SC_API_KEY', previousScKey);
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
