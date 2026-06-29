import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCommandOutput } from './run-shell.js';

test('formatCommandOutput keeps stderr readable when stdout is empty', () => {
  assert.equal(formatCommandOutput('', 'warning'), '[stderr]\nwarning');
});

test('formatCommandOutput separates stdout and stderr when both are present', () => {
  assert.equal(formatCommandOutput('output', 'warning'), 'output\n[stderr]\nwarning');
});

test('formatCommandOutput keeps stdout unchanged when stderr is empty', () => {
  assert.equal(formatCommandOutput('output', ''), 'output');
});
