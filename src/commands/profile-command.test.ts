import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('profile command shows help and examples when no subcommand is provided', () => {
  const cliPath = path.resolve('bin/sc.js');
  const result = spawnSync(process.execPath, [cliPath, 'profile'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: sc profile \[options] \[command]/);
  assert.match(result.stdout, /Manage model profiles/);
  assert.match(result.stdout, /Examples:/);
  assert.match(result.stdout, /\$ sc profile list/);
  assert.match(result.stdout, /\$ sc profile use openai/);
  assert.equal(result.stderr, '');
});
