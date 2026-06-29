import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function withTempHome(
  config: Record<string, unknown>,
  callback: (homeDir: string) => void
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-test-'));

  try {
    const configDir = path.join(homeDir, '.sc-agent');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify(config, null, 2),
      'utf-8'
    );
    callback(homeDir);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

function runCli(homeDir: string, args: string[]) {
  return spawnSync(process.execPath, ['bin/sc.js', ...args], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    encoding: 'utf-8',
  });
}

test('profile list shows guidance when no profiles are configured', async () => {
  await withTempHome(
    {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      profiles: null,
      activeProfile: null,
    },
    (homeDir) => {
      const result = runCli(homeDir, ['profile', 'list']);

      assert.equal(result.status, 0);
      assert.match(result.stdout, /No profiles configured yet\./);
      assert.match(result.stdout, /sc profile add <name>/);
    }
  );
});

test('profile use suggests listing profiles when the requested profile is missing', async () => {
  await withTempHome(
    {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      profiles: {
        ollama: {
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.2',
        },
      },
      activeProfile: 'ollama',
    },
    (homeDir) => {
      const result = runCli(homeDir, ['profile', 'use', 'missing']);

      assert.equal(result.status, 0);
      assert.match(result.stdout, /Profile "missing" not found\./);
      assert.match(result.stdout, /sc profile list/);
    }
  );
});
