import test from 'node:test';
import assert from 'node:assert/strict';
import { findClosestProfileName, formatMissingProfileMessage } from './profile.js';

test('findClosestProfileName suggests the nearest configured profile', () => {
  const suggestion = findClosestProfileName('opneai', ['ollama', 'openai', 'anthropic']);
  assert.equal(suggestion, 'openai');
});

test('findClosestProfileName ignores distant profile names', () => {
  const suggestion = findClosestProfileName('production', ['ollama', 'openai', 'anthropic']);
  assert.equal(suggestion, undefined);
});

test('formatMissingProfileMessage includes suggestion and next steps', () => {
  const message = formatMissingProfileMessage(
    'opneai',
    ['ollama', 'openai', 'anthropic'],
    'use'
  );

  assert.match(message, /Did you mean "openai"\?/);
  assert.match(message, /Available profiles: ollama, openai, anthropic\./);
  assert.match(message, /Run "sc profile use <name>" or "sc profile list" for details\./);
});

test('formatMissingProfileMessage omits suggestion when there is no close match', () => {
  const message = formatMissingProfileMessage(
    'production',
    ['ollama', 'openai', 'anthropic'],
    'remove'
  );

  assert.doesNotMatch(message, /Did you mean/);
  assert.match(message, /Run "sc profile remove <name>" or "sc profile list" for details\./);
});
