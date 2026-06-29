import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../bin/sc.js');

test('shows contextual help and suggestions for unknown subcommands', () => {
  const result = spawnSync(process.execPath, [cliPath, 'profile', 'remov'], {
    encoding: 'utf-8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /error: unknown command 'remov'/i);
  assert.match(result.stderr, /Did you mean remove\?/i);
  assert.match(result.stderr, /Usage: sc profile \[options\] \[command\]/);
});
