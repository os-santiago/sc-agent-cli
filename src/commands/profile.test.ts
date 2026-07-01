import test from 'node:test';
import assert from 'node:assert/strict';
import { getAddProfileValidationError, normalizeProfileName } from './profile.js';

test('normalizeProfileName trims surrounding whitespace', () => {
  assert.equal(normalizeProfileName('  openai  '), 'openai');
});

test('normalizeProfileName rejects blank names', () => {
  assert.equal(normalizeProfileName('   '), undefined);
});

test('getAddProfileValidationError requires a name', () => {
  assert.equal(
    getAddProfileValidationError(undefined, {}),
    'Profile name is required'
  );
});

test('getAddProfileValidationError blocks duplicate profile names', () => {
  assert.equal(
    getAddProfileValidationError('openai', { openai: { model: 'gpt-4o' } }),
    'Profile "openai" already exists. Use a different name or edit ~/.sc-agent/config.json directly.'
  );
});

test('getAddProfileValidationError allows new unique names', () => {
  assert.equal(
    getAddProfileValidationError('my-model', { openai: { model: 'gpt-4o' } }),
    undefined
  );
});
