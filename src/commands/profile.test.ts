import test from 'node:test';
import assert from 'node:assert/strict';
import { getExistingProfileMessage } from './profile.js';

test('getExistingProfileMessage explains how to reuse or replace an existing profile', () => {
  const message = getExistingProfileMessage('ollama');

  assert.match(message, /Profile "ollama" already exists\./);
  assert.match(message, /sc profile use ollama/);
  assert.match(message, /sc profile remove ollama/);
});
