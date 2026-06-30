import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNoProfilesMessage, buildProfileNotFoundMessage } from './profile.js';

test('buildNoProfilesMessage suggests how to recover from an empty profile set', () => {
  const message = buildNoProfilesMessage('use');

  assert.match(message, /No profiles configured\./);
  assert.match(message, /sc profile add <name>/);
  assert.match(message, /sc config-init --force/);
});

test('buildProfileNotFoundMessage lists available profiles and a next step', () => {
  const message = buildProfileNotFoundMessage('prod', ['ollama', 'openai']);

  assert.match(message, /Profile "prod" not found\./);
  assert.match(message, /Available profiles: ollama, openai\./);
  assert.match(message, /sc profile list/);
});

test('buildProfileNotFoundMessage falls back to empty-state guidance when no profiles exist', () => {
  const message = buildProfileNotFoundMessage('prod', []);

  assert.match(message, /Profile "prod" not found\./);
  assert.match(message, /No profiles configured\./);
  assert.match(message, /sc config-init --force/);
});
