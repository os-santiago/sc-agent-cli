import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPermissionDetails } from './permissions.js';

test('formatPermissionDetails summarizes long write_file content for readable prompts', () => {
  const details = formatPermissionDetails('write_file', {
    path: 'src/example.ts',
    content: `export const message = "${'x'.repeat(120)}";`,
  });

  assert.deepEqual(details, [
    'Path: src/example.ts',
    'Content: export const message = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx... (146 chars)',
  ]);
});

test('formatPermissionDetails keeps run_shell prompts focused on the command preview', () => {
  const details = formatPermissionDetails('run_shell', {
    command: 'npm test -- --runInBand',
    cwd: '/tmp/project',
  });

  assert.deepEqual(details, ['Command: npm test -- --runInBand']);
});

test('formatPermissionDetails falls back to compact generic argument summaries', () => {
  const details = formatPermissionDetails('custom_tool', {
    path: 'README.md',
    recursive: true,
    files: ['a', 'b'],
    ignored: 'extra',
  });

  assert.deepEqual(details, [
    'path: README.md',
    'recursive: true',
    'files: [2 item(s)]',
  ]);
});
