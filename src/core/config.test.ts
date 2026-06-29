import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('config init and profile removal semantics behave correctly', async () => {
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
    await writeFile(
      configPath,
      JSON.stringify(
        {
          profiles: {
            custom: {
              baseUrl: 'https://example.test/v1',
              model: 'custom-model',
            },
          },
          activeProfile: null,
        },
        null,
        2
      ),
      'utf-8'
    );

    const loadedConfig = await configModule.loadConfig();

    assert.deepEqual(Object.keys(loadedConfig.profiles || {}), ['custom']);
    assert.equal(loadedConfig.activeProfile, undefined);
    assert.equal(loadedConfig.model.model, 'llama3.2');
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

    await rm(tempHome, { recursive: true, force: true });
  }
});
