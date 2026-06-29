import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelProfileEmptyStateGuidance } from './chat-session.js';

test('getModelProfileEmptyStateGuidance includes actionable next steps', () => {
  assert.deepEqual(getModelProfileEmptyStateGuidance(), [
    'No model profiles available.',
    'Run `sc profile add <name>` to create one.',
    'Run `sc config-init` to restore the default profiles.',
  ]);
});
