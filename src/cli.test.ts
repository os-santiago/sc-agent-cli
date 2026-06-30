import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const workspaceRoot = path.resolve(currentDir, '..');
const cliEntry = path.join(workspaceRoot, 'dist', 'cli.js');

test('cli shows command help after an invalid option error', () => {
  const result = spawnSync(process.execPath, [cliEntry, 'chat', '--bogus'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /error: unknown option '--bogus'/i);
  assert.match(result.stderr, /Usage: sc chat \[options\] \[prompt\]/);
  assert.match(result.stderr, /Start an interactive chat session/);
});
