import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoApproveForPermissionMode } from './permission-mode.js';

test('shouldAutoApproveForPermissionMode only enables auto-approve in unlimited mode', () => {
  assert.equal(shouldAutoApproveForPermissionMode('ask_once'), false);
  assert.equal(shouldAutoApproveForPermissionMode('always_ask'), false);
  assert.equal(shouldAutoApproveForPermissionMode('unlimited'), true);
});
