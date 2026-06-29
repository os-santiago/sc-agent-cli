import test from 'node:test';
import assert from 'node:assert/strict';
import { autocomplete } from './autocomplete.js';

const workspaceRoot = process.cwd();

test('autocomplete returns nested relative path completions with the matched token', () => {
  const [matches, token] = autocomplete('read src/co', workspaceRoot);

  assert.equal(token, 'src/co');
  assert.deepEqual(matches, ['src/commands/', 'src/core/']);
});

test('autocomplete preserves dot-relative prefixes for nested paths', () => {
  const [matches, token] = autocomplete('./src/co', workspaceRoot);

  assert.equal(token, './src/co');
  assert.deepEqual(matches, ['./src/commands/', './src/core/']);
});

test('autocomplete preserves Windows-style separators in suggestions', () => {
  const [matches, token] = autocomplete('read .\\src\\co', workspaceRoot);

  assert.equal(token, '.\\src\\co');
  assert.deepEqual(matches, ['.\\src\\commands\\', '.\\src\\core\\']);
});
