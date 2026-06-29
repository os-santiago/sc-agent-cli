import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const cliPath = path.join(repoRoot, 'bin', 'sc.js');

function runCli(args: string[], homeDir: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
  });
}

test('profile command failures use stderr and exit with code 1', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-errors-'));
  const configDir = path.join(tempHome, '.sc-agent');
  const configPath = path.join(configDir, 'config.json');

  try {
    const missingProfile = runCli(['profile', 'use', 'missing'], tempHome);
    assert.equal(missingProfile.status, 1);
    assert.match(missingProfile.stderr, /Profile "missing" not found/);
    assert.equal(missingProfile.stdout, '');

    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, JSON.stringify({
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
        temperature: 0.7,
        maxTokens: 4096,
        stream: true,
      },
      permissions: {
        autoApprove: ['read_file', 'list_dir', 'search_text'],
        denyPaths: ['.env'],
      },
      profiles: null,
    }), 'utf-8');

    const noProfiles = runCli(['profile', 'remove'], tempHome);
    assert.equal(noProfiles.status, 1);
    assert.match(noProfiles.stderr, /No profiles available/);
    assert.equal(noProfiles.stdout, '');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
