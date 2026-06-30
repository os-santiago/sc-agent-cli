import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getGlobalConfigPath, loadConfig, setActiveProfile, validateConfig } from './config.js';
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
  const tempHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-'));
  const projectConfigPath = path.join(projectRoot, '.sc-agent.json');
  const configModuleUrl = pathToFileURL(path.resolve('dist/core/config.js')).href;

  await writeFile(projectConfigPath, '{"model":', 'utf-8');

  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        `import { loadConfig } from ${JSON.stringify(configModuleUrl)};`,
        `try {`,
        `  await loadConfig(${JSON.stringify(projectRoot)});`,
        `  process.exit(0);`,
        `} catch (err) {`,
        `  console.error(err instanceof Error ? err.message : String(err));`,
        `  process.exit(1);`,
        `}`,
      ].join('\n'),
    ],
    {
      cwd: path.resolve('.'),
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON in project config/);
  assert.match(result.stderr, new RegExp(escapeRegex(projectConfigPath)));
  assert.match(result.stderr, /sc config-init/);
});

test('setActiveProfile saves global selection and clears project override', async () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-project-'));
  const projectConfigPath = path.join(projectRoot, '.sc-agent.json');

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const globalConfigPath = getGlobalConfigPath();
    await mkdir(path.dirname(globalConfigPath), { recursive: true });
    await writeFile(globalConfigPath, JSON.stringify({ activeProfile: 'ollama' }, null, 2), 'utf-8');
    await writeFile(
      projectConfigPath,
      JSON.stringify({
        activeProfile: 'project-model',
        profiles: {
          'project-model': {
            baseUrl: 'http://localhost:11434/v1',
            model: 'project-model',
          },
        },
      }, null, 2),
      'utf-8'
    );

    const scope = await setActiveProfile('openai', projectRoot);

    assert.equal(scope, 'global');

    const globalConfig = JSON.parse(await readFile(globalConfigPath, 'utf-8')) as ProjectConfig;
    const projectConfig = JSON.parse(await readFile(projectConfigPath, 'utf-8')) as ProjectConfig;

    assert.equal(globalConfig.activeProfile, 'openai');
    assert.equal(projectConfig.activeProfile, undefined);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  }
});

test('setActiveProfile saves project-local profiles in project config', async () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-project-'));
  const projectConfigPath = path.join(projectRoot, '.sc-agent.json');

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    await writeFile(
      projectConfigPath,
      JSON.stringify({
        profiles: {
          custom: {
            baseUrl: 'http://localhost:11434/v1',
            model: 'custom-model',
          },
        },
      }, null, 2),
      'utf-8'
    );

    const scope = await setActiveProfile('custom', projectRoot);

    assert.equal(scope, 'project');

    const projectConfig = JSON.parse(await readFile(projectConfigPath, 'utf-8')) as ProjectConfig;
    assert.equal(projectConfig.activeProfile, 'custom');
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
