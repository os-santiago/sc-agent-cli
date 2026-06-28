import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

test('profile list prints a clean error instead of a stack trace for invalid global config JSON', () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'sc-agent-home-'));

  try {
    mkdirSync(join(tempHome, '.sc-agent'), { recursive: true });
    writeFileSync(join(tempHome, '.sc-agent', 'config.json'), '{ invalid json');

    const result = spawnSync(process.execPath, ['bin/sc.js', 'profile', 'list'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        FORCE_COLOR: '0',
      },
      encoding: 'utf-8',
    });

    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /^Error: Invalid global config at/m);
    assert.doesNotMatch(result.stderr, /at readConfigFile/);
    assert.doesNotMatch(result.stderr, /Node\.js v/);
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});
