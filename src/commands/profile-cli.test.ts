import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectConfig } from '../core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

async function withTempHome(config: Partial<ProjectConfig>, callback: (homeDir: string) => void): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-cli-test-'));

  try {
    const configDir = path.join(homeDir, '.sc-agent');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    callback(homeDir);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

function runProfileCommand(homeDir: string, args: string[]) {
  return spawnSync(process.execPath, ['bin/sc.js', 'profile', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    encoding: 'utf-8',
    timeout: 10000,
  });
}

test('profile command failures use stderr and exit non-zero', async () => {
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
      const missingProfile = runProfileCommand(homeDir, ['use', 'missing']);
      assert.equal(missingProfile.status, 1);
      assert.equal(missingProfile.stdout.trim(), '');
      assert.match(missingProfile.stderr, /Profile "missing" not found/);
    }
  );

  await withTempHome(
    {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      profiles: null as unknown as ProjectConfig['profiles'],
      activeProfile: undefined,
    },
    (homeDir) => {
      const emptyRemove = runProfileCommand(homeDir, ['remove']);
      assert.equal(emptyRemove.status, 1);
      assert.equal(emptyRemove.stdout.trim(), '');
      assert.match(emptyRemove.stderr, /No profiles available/);
    }
  );
});
