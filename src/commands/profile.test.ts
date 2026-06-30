import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProfileInput,
  validateProfileBaseUrl,
  validateRequiredProfileField,
} from './profile.js';

test('normalizeProfileInput trims surrounding whitespace', () => {
  assert.equal(normalizeProfileInput('  demo-profile  '), 'demo-profile');
  assert.equal(normalizeProfileInput(undefined), '');
});

test('validateRequiredProfileField rejects blank values', () => {
  assert.equal(validateRequiredProfileField('   ', 'Profile name'), 'Profile name is required');
  assert.equal(validateRequiredProfileField('openai', 'Profile name'), true);
});

test('validateProfileBaseUrl accepts valid http and https URLs', () => {
  assert.equal(validateProfileBaseUrl('http://localhost:11434/v1'), true);
  assert.equal(validateProfileBaseUrl(' https://api.openai.com/v1 '), true);
});

test('validateProfileBaseUrl rejects empty, malformed, and unsupported URLs', () => {
  assert.equal(validateProfileBaseUrl('   '), 'Base URL is required');
  assert.equal(
    validateProfileBaseUrl('not a url'),
    'Base URL must be a valid http:// or https:// URL'
  );
  assert.equal(
    validateProfileBaseUrl('ftp://example.com'),
    'Base URL must start with http:// or https://'
  );
});
