import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMissingProfile } from './profile.js';

test('describeMissingProfile suggests the closest profile name for typos', () => {
  const result = describeMissingProfile('opnai', ['anthropic', 'openai', 'ollama']);

  assert.equal(result.suggestion, 'openai');
  assert.deepEqual(result.availableProfiles, ['anthropic', 'ollama', 'openai']);
});

test('describeMissingProfile does not guess when there is no close profile', () => {
  const result = describeMissingProfile('vertex', ['anthropic', 'openai', 'ollama']);

  assert.equal(result.suggestion, undefined);
  assert.deepEqual(result.availableProfiles, ['anthropic', 'ollama', 'openai']);
});
