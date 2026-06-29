import test from 'node:test';
import assert from 'node:assert/strict';
<<<<<<< HEAD
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('initConfig requires --force before overwriting an existing global config', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-test-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const configModule = await import(`./config.js?test=${Date.now()}`);
    const configPath = configModule.getGlobalConfigPath();

    await configModule.initConfig();

    const customConfig = {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'https://example.test/v1',
        model: 'custom-model',
        temperature: 0.1,
        maxTokens: 256,
        stream: false,
      },
      permissions: {
        autoApprove: ['read_file'],
        denyPaths: ['.env'],
      },
      profiles: {
        custom: {
          baseUrl: 'https://example.test/v1',
          model: 'custom-model',
        },
      },
      activeProfile: 'custom',
    };

    await writeFile(configPath, JSON.stringify(customConfig, null, 2), 'utf-8');

    await assert.rejects(
      () => configModule.initConfig(),
      /Config already exists .*sc config-init --force/
    );

    const preservedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
    assert.equal(preservedConfig.activeProfile, 'custom');
    assert.equal(preservedConfig.model.baseUrl, 'https://example.test/v1');

    await configModule.initConfig(true);

    const resetConfig = JSON.parse(await readFile(configPath, 'utf-8'));
    assert.equal(resetConfig.activeProfile, 'ollama');
    assert.equal(resetConfig.model.baseUrl, 'http://localhost:11434/v1');
=======
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('loadConfig preserves an explicitly empty profile map', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-test-'));
  const parsedHome = path.parse(tempHome);
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalHomeDrive = process.env.HOMEDRIVE;
  const originalHomePath = process.env.HOMEPATH;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.HOMEDRIVE = parsedHome.root.replace(/[\\\/]+$/, '');
  process.env.HOMEPATH = tempHome.slice(parsedHome.root.length - 1);

  try {
    const configDir = path.join(tempHome, '.sc-agent');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify(
        {
          model: {
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:11434/v1',
            model: 'llama3.2',
          },
          profiles: {},
          activeProfile: null,
        },
        null,
        2
      ),
      'utf-8'
    );

    const configModule = await import(`./config.js?test=${Date.now()}`);
    const config = await configModule.loadConfig();

    assert.deepEqual(config.profiles, {});
    assert.equal(config.activeProfile, null);
>>>>>>> fix/profile-list-empty-state-guidance
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

<<<<<<< HEAD
=======
    if (originalHomeDrive === undefined) {
      delete process.env.HOMEDRIVE;
    } else {
      process.env.HOMEDRIVE = originalHomeDrive;
    }

    if (originalHomePath === undefined) {
      delete process.env.HOMEPATH;
    } else {
      process.env.HOMEPATH = originalHomePath;
    }

>>>>>>> fix/profile-list-empty-state-guidance
    await rm(tempHome, { recursive: true, force: true });
  }
});
