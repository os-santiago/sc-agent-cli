import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('cli surfaces async command failures without an unhandled rejection stack', async () => {
  const fakeHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-cli-home-'));
  const configDir = path.join(fakeHome, '.sc-agent');
  const configPath = path.join(configDir, 'config.json');

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, '{"model":', 'utf-8');

  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, 'profile', 'list'], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Invalid JSON in global config/);
  assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection|at async|node:internal/i);
});
