import test from 'node:test';
import assert from 'node:assert/strict';
import { getPromptBoolean, getPromptString } from './prompt-result.js';

test('getPromptBoolean returns true and false for explicit confirmations', () => {
  assert.equal(getPromptBoolean({ value: true }), true);
  assert.equal(getPromptBoolean({ value: false }), false);
});

test('getPromptBoolean returns null when the prompt was cancelled', () => {
  assert.equal(getPromptBoolean({}), null);
  assert.equal(getPromptBoolean({ value: 'yes' }), null);
});

test('getPromptString returns the selected option and null for cancellation', () => {
  assert.equal(getPromptString<'session'>({ choice: 'session' }, 'choice'), 'session');
  assert.equal(getPromptString({ choice: '' }, 'choice'), null);
  assert.equal(getPromptString({}, 'choice'), null);
});
