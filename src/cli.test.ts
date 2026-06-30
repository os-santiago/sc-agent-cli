import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(currentDir, '../dist/cli.js');

test('cli usage errors include suggestions and help guidance', () => {
  const result = spawnSync(process.execPath, [cliEntry, 'chat', '--qeit'], {
    encoding: 'utf-8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /error: unknown option '--qeit'/i);
  assert.match(result.stderr, /Did you mean --quiet\?/i);
  assert.match(result.stderr, /Usage: sc chat \[options\] \[prompt\]/i);
  assert.match(result.stderr, /display help for command/i);
});
