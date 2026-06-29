import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runProfileAdd(homeDir: string, name: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['dist/cli.js', 'profile', 'add', name],
    {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
      encoding: 'utf-8',
    }
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test('profile add rejects whitespace-only names without creating config', () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'sc-agent-profile-add-'));

  try {
    const result = runProfileAdd(homeDir, '   ');

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Profile name cannot be empty/);
    assert.equal(result.stderr, '');
    assert.throws(() => readFileSync(path.join(homeDir, '.sc-agent', 'config.json'), 'utf-8'));
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('profile add keeps existing profiles safe from accidental overwrite', () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'sc-agent-profile-add-'));

  try {
    const result = runProfileAdd(homeDir, 'openai');

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Profile "openai" already exists/);
    assert.equal(result.stderr, '');
    assert.throws(() => readFileSync(path.join(homeDir, '.sc-agent', 'config.json'), 'utf-8'));
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
