import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNewProfileName, validateProfileDetails } from './profile.js';

test('validateNewProfileName trims surrounding whitespace', () => {
  const result = validateNewProfileName('  local-dev  ', {});
  assert.equal(result, 'local-dev');
});

test('validateNewProfileName rejects duplicate names', () => {
  assert.throws(
    () => validateNewProfileName('ollama', { ollama: { model: 'llama3.2' } }),
    /already exists/
  );
});

test('validateProfileDetails rejects blank values', () => {
  assert.throws(() => validateProfileDetails('   ', 'gpt-4o'), /Base URL is required/);
  assert.throws(
    () => validateProfileDetails('https://example.test/v1', '   '),
    /Model name is required/
  );
});

test('validateProfileDetails trims saved values', () => {
  const result = validateProfileDetails(' https://example.test/v1 ', ' my-model ');
  assert.deepEqual(result, {
    baseUrl: 'https://example.test/v1',
    model: 'my-model',
  });
});
