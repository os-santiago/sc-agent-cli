import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI_PATH = path.resolve(process.cwd(), 'bin/sc.js');

async function createTempHome(config: Record<string, unknown>): Promise<string> {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-test-'));
  const configDir = path.join(tempHome, '.sc-agent');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  return tempHome;
}

function runCli(args: string[], homeDir: string) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: path.dirname(CLI_PATH),
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH,
      HOME: homeDir,
      USERPROFILE: homeDir,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      PATHEXT: process.env.PATHEXT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    },
  });
}

test('profile list still works when the active profile is missing an API key', async () => {
  const tempHome = await createTempHome({
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      stream: true,
    },
    profiles: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      },
    },
    activeProfile: 'openai',
  });

  try {
    const result = runCli(['profile', 'list'], tempHome);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Available Profiles/);
    assert.match(result.stdout, /openai \(active\)/);
    assert.equal(result.stderr, '');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('profile use can recover from an invalid active profile without rewriting base model config', async () => {
  const tempHome = await createTempHome({
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      stream: true,
    },
    profiles: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      },
    },
    activeProfile: 'openai',
  });

  try {
    const result = runCli(['profile', 'use', 'ollama'], tempHome);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Switched to profile "ollama"/);

    const savedConfig = JSON.parse(
      await readFile(path.join(tempHome, '.sc-agent', 'config.json'), 'utf-8')
    ) as {
      activeProfile?: string;
      model: {baseUrl?: string; model?: string};
    };

    assert.equal(savedConfig.activeProfile, 'ollama');
    assert.equal(savedConfig.model.baseUrl, 'http://localhost:11434/v1');
    assert.equal(savedConfig.model.model, 'llama3.2');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
