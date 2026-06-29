import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoApproveForMode } from './chat-session.js';

test('shouldAutoApproveForMode only enables auto-approve for unlimited mode', () => {
  assert.equal(shouldAutoApproveForMode('ask_once'), false);
  assert.equal(shouldAutoApproveForMode('always_ask'), false);
  assert.equal(shouldAutoApproveForMode('unlimited'), true);
});
