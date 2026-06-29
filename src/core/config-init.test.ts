import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');

function runConfigInit(homeDir: string, ...args: string[]) {
  return spawnSync('node', ['bin/sc.js', 'config-init', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    windowsHide: true,
  });
}

test('config-init preserves an existing global config unless --force is used', () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'sc-config-init-'));
  const configPath = path.join(homeDir, '.sc-agent', 'config.json');

  try {
    const initial = runConfigInit(homeDir);
    assert.equal(initial.status, 0, initial.stderr);
    assert.match(initial.stdout, /Config initialized at/i);

    const originalConfig = readFileSync(configPath, 'utf8');

    const secondRun = runConfigInit(homeDir);
    assert.equal(secondRun.status, 1);
    assert.match(secondRun.stderr, /already exists/i);
    assert.match(secondRun.stderr, /--force/i);
    assert.equal(readFileSync(configPath, 'utf8'), originalConfig);

    const forcedRun = runConfigInit(homeDir, '--force');
    assert.equal(forcedRun.status, 0, forcedRun.stderr);
    assert.match(forcedRun.stdout, /Config initialized at/i);
    assert.notEqual(readFileSync(configPath, 'utf8').length, 0);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
