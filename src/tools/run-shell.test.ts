import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRunShellFailure } from './run-shell.js';

test('formatRunShellFailure adds Windows guidance when the command is missing', () => {
  const message = formatRunShellFailure(
    'rg missing-file',
    1,
    '',
    "'rg' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n",
    'win32',
  );

  assert.match(message, /Command exited with code 1/);
  assert.match(message, /\[stderr\]/);
  assert.match(message, /Tip: "rg" is not available in this Windows shell/);
  assert.match(message, /use the PowerShell equivalent, or run it via WSL/);
});

test('formatRunShellFailure adds POSIX guidance when the command is missing', () => {
  const message = formatRunShellFailure(
    'rg missing-file',
    127,
    '',
    '/bin/sh: rg: command not found\n',
    'linux',
  );

  assert.match(message, /Command exited with code 127/);
  assert.match(message, /Tip: "rg" is not available in this shell/);
});

test('formatRunShellFailure leaves generic command failures unchanged', () => {
  const message = formatRunShellFailure(
    'git status',
    128,
    '',
    'fatal: not a git repository\n',
    'linux',
  );

  assert.equal(message, 'Command exited with code 128\n\n[stderr]\nfatal: not a git repository\n');
});
