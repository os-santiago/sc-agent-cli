import test from 'node:test';
import assert from 'node:assert/strict';
import { getPermissionModeChoices, getPermissionModeInitial } from './permission-mode.js';

test('getPermissionModeChoices marks the current permission mode', () => {
  const choices = getPermissionModeChoices('always_ask');

  assert.equal(choices[0]?.title, 'Ask once per command (recommended)');
  assert.equal(choices[1]?.title, 'Always ask (safer) (current)');
  assert.equal(choices[2]?.title, 'Unlimited (dangerous)');
});

test('getPermissionModeInitial points to the active mode', () => {
  assert.equal(getPermissionModeInitial('ask_once'), 0);
  assert.equal(getPermissionModeInitial('always_ask'), 1);
  assert.equal(getPermissionModeInitial('unlimited'), 2);
});
