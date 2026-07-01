import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProfileName,
  buildMissingProfileMessage,
  buildDuplicateProfileMessage,
} from './profile.js';

test('normalizeProfileName trims whitespace and rejects blank values', () => {
  assert.equal(normalizeProfileName('  openai  '), 'openai');
  assert.equal(normalizeProfileName('   '), undefined);
  assert.equal(normalizeProfileName(undefined), undefined);
});

test('buildMissingProfileMessage suggests listing when profiles exist', () => {
  assert.equal(
    buildMissingProfileMessage('missing', ['ollama', 'openai']),
    'Profile "missing" not found. Run "sc profile list" to see available profiles.'
  );
});

test('buildMissingProfileMessage suggests creation when no profiles exist', () => {
  assert.equal(
    buildMissingProfileMessage('missing', []),
    'Profile "missing" not found. Run "sc profile add <name>" to create one.'
  );
});

test('buildDuplicateProfileMessage explains how to avoid overwriting an existing profile', () => {
  assert.equal(
    buildDuplicateProfileMessage('openai'),
    'Profile "openai" already exists. Use "sc profile use openai" to switch to it or "sc profile remove openai" before recreating it.'
  );
});
