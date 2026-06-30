import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig } from './config.js';
import type { ProjectConfig } from './types.js';

const execFileAsync = promisify(execFile);

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

test('initConfig does not overwrite an existing global config unless force is enabled', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const configPath = path.join(tempHome, '.sc-agent', 'config.json');

  try {
    await runInitConfigScript(false, tempHome);
    const initialContent = await readFile(configPath, 'utf-8');

    await writeFile(configPath, '{"model":{"baseUrl":"http://example.com","model":"custom"}}', 'utf-8');

    await assert.rejects(
      () => runInitConfigScript(false, tempHome),
      /Global config already exists.*sc config-init --force/
    );

    const preservedContent = await readFile(configPath, 'utf-8');
    assert.equal(
      preservedContent,
      '{"model":{"baseUrl":"http://example.com","model":"custom"}}'
    );

    await runInitConfigScript(true, tempHome);
    const overwrittenContent = await readFile(configPath, 'utf-8');
    assert.equal(overwrittenContent, initialContent);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runInitConfigScript(force: boolean, tempHome: string): Promise<void> {
  const script = `
    const modulePath = new URL('./config.js', import.meta.url).href;
    const { initConfig } = await import(modulePath);
    await initConfig(${force ? 'true' : 'false'});
  `;

  await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
    }
  );
}
