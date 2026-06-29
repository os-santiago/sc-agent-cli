import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('initConfig requires --force before overwriting an existing global config', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-test-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const configModule = await import(`./config.js?test=${randomUUID()}`);
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

test('loadConfig explains how to recover when model.baseUrl is missing', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-test-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const configModule = await import(`./config.js?test=${randomUUID()}`);
    const configPath = configModule.getGlobalConfigPath();

    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        model: {
          provider: 'openai-compatible',
          baseUrl: '',
          model: 'gpt-4o',
        },
        activeProfile: null,
      }),
      'utf-8'
    );

    await assert.rejects(
      () => configModule.loadConfig(),
      /Missing required config field: model\.baseUrl\..*Run "sc config-init"/
    );
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

test('loadConfig gives provider-specific API key guidance for hosted profiles', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-test-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const originalNvidiaApiKey = process.env.NVIDIA_API_KEY;
  const originalScApiKey = process.env.SC_API_KEY;

  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.SC_API_KEY;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const configModule = await import(`./config.js?test=${randomUUID()}`);
    const configPath = configModule.getGlobalConfigPath();

    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        model: {
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        },
        activeProfile: 'openai',
      }),
      'utf-8'
    );

    await assert.rejects(
      () => configModule.loadConfig(),
      /Missing API key for "openai"\. Set OPENAI_API_KEY \(or SC_API_KEY\), or add model\.apiKey/
    );
  } finally {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }

    if (originalAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }

    if (originalNvidiaApiKey === undefined) {
      delete process.env.NVIDIA_API_KEY;
    } else {
      process.env.NVIDIA_API_KEY = originalNvidiaApiKey;
    }

    if (originalScApiKey === undefined) {
      delete process.env.SC_API_KEY;
    } else {
      process.env.SC_API_KEY = originalScApiKey;
    }

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
