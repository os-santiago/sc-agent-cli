import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPermissionDetails } from './permissions.js';

test('formatPermissionDetails summarizes write_file content without dumping full payload', () => {
  const content = ['first line', 'second line', 'third line', 'fourth line'].join('\n');

  const details = formatPermissionDetails('write_file', {
    path: 'src/example.ts',
    content,
  });

  assert.deepEqual(details, [
    'Path: src/example.ts',
    'Content: 45 chars, 4 lines, preview="first line second line third line fourth line"',
  ]);
});

test('formatPermissionDetails truncates long shell commands', () => {
  const command = `node -e "${'x'.repeat(140)}"`;

  const details = formatPermissionDetails('run_shell', { command });

  assert.equal(details.length, 1);
  assert.match(details[0], /^Command: node -e "/);
  assert.match(details[0], /\.\.\.$/);
  assert.ok(details[0].length <= 109);
});

test('formatPermissionDetails falls back to compact generic formatting', () => {
  const details = formatPermissionDetails('list_dir', {
    path: 'src',
    recursive: true,
    filters: ['*.ts', '*.md'],
  });

  assert.deepEqual(details, [
    'path: src',
    'recursive: true',
    'filters: ["*.ts","*.md"]',
  ]);
});
