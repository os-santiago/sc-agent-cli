import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAvailableProfiles,
  getMissingProfileMessage,
  normalizeProfileName,
} from './profile.js';

test('normalizeProfileName trims surrounding whitespace', () => {
  assert.equal(normalizeProfileName('  openai  '), 'openai');
});

test('normalizeProfileName returns undefined for empty names', () => {
  assert.equal(normalizeProfileName('   '), undefined);
  assert.equal(normalizeProfileName(undefined), undefined);
});

test('formatAvailableProfiles lists configured profiles', () => {
  assert.equal(
    formatAvailableProfiles(['ollama', 'openai']),
    'Available profiles: ollama, openai'
  );
});

test('formatAvailableProfiles handles missing profiles', () => {
  assert.equal(
    formatAvailableProfiles([]),
    'No profiles are currently configured.'
  );
});

test('getMissingProfileMessage suggests next steps for switching profiles', () => {
  assert.equal(
    getMissingProfileMessage('use', 'prod', ['ollama', 'openai']),
    'Profile "prod" not found. Available profiles: ollama, openai Use "sc profile list" to inspect profile settings before you switch to one.'
  );
});

test('getMissingProfileMessage suggests next steps for removing profiles', () => {
  assert.equal(
    getMissingProfileMessage('remove', 'prod', []),
    'Profile "prod" not found. No profiles are currently configured. Use "sc profile list" to inspect profile settings before you remove one.'
  );
});
