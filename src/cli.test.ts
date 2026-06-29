import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

test('profile add refuses to overwrite an existing profile without --force', () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'sc-agent-home-'));

  try {
    mkdirSync(join(tempHome, '.sc-agent'), { recursive: true });
    writeFileSync(
      join(tempHome, '.sc-agent', 'config.json'),
      JSON.stringify({
        profiles: {
          custom: {
            baseUrl: 'https://example.test/v1',
            model: 'custom-model',
            apiKey: 'existing-key',
          },
        },
        activeProfile: 'custom',
      }, null, 2),
      'utf-8'
    );

    const result = spawnSync(process.execPath, ['bin/sc.js', 'profile', 'add', 'custom'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        FORCE_COLOR: '0',
      },
      encoding: 'utf-8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Profile "custom" already exists/);
    assert.match(result.stdout, /sc profile add custom --force/);

    const config = JSON.parse(readFileSync(join(tempHome, '.sc-agent', 'config.json'), 'utf-8'));
    assert.deepEqual(config.profiles.custom, {
      baseUrl: 'https://example.test/v1',
      model: 'custom-model',
      apiKey: 'existing-key',
    });
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});
