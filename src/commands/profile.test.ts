import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNoProfilesMessage, formatProfileNotFoundMessage } from './profile.js';

test('formatNoProfilesMessage explains how to bootstrap profiles', () => {
  assert.equal(
    formatNoProfilesMessage('list'),
    'No profiles configured. Run "sc config-init" to create the default profiles or "sc profile add <name>" to add one.'
  );

  assert.equal(
    formatNoProfilesMessage('select'),
    'No profiles available. Run "sc config-init" to create the default profiles or "sc profile add <name>" to add one.'
  );
});

test('formatProfileNotFoundMessage points users to profile list', () => {
  assert.equal(
    formatProfileNotFoundMessage('missing'),
    'Profile "missing" not found. Run "sc profile list" to see available profiles.'
  );
});
