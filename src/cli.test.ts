import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, 'cli.js');

test('cli suggests the closest nested command name after a typo', () => {
  const result = spawnSync(process.execPath, [cliPath, 'profile', 'lsit'], {
    encoding: 'utf-8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command 'lsit'/i);
  assert.match(result.stderr, /Did you mean list\?/i);
});
