import test from 'node:test';
import assert from 'node:assert/strict';
import { getSlashCommandSuggestions, isKnownSlashCommand } from './autocomplete.js';

test('isKnownSlashCommand matches supported commands case-insensitively', () => {
  assert.equal(isKnownSlashCommand('/help'), true);
  assert.equal(isKnownSlashCommand(' /PROFILE '), true);
  assert.equal(isKnownSlashCommand('/unknown'), false);
});

test('getSlashCommandSuggestions prefers prefix matches for partial commands', () => {
  assert.deepEqual(getSlashCommandSuggestions('/pre'), ['/pre-approved-commands']);
});

test('getSlashCommandSuggestions returns close matches for typos', () => {
  assert.deepEqual(getSlashCommandSuggestions('/storag'), ['/storage']);
  assert.deepEqual(getSlashCommandSuggestions('/permisions'), ['/permissions']);
});
