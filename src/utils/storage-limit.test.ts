import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStorageCleanupHint,
  getStorageLimitExample,
} from './storage-limit.js';

test('storage guidance uses PowerShell examples on Windows', () => {
  assert.equal(getStorageLimitExample('win32'), '$env:SC_MAX_STORAGE_GB = "2"');
  assert.equal(getStorageCleanupHint('win32'), 'Remove old files under $HOME\\.sc-agent');
});

test('storage guidance uses POSIX examples on non-Windows platforms', () => {
  assert.equal(getStorageLimitExample('linux'), 'export SC_MAX_STORAGE_GB=2');
  assert.equal(getStorageCleanupHint('linux'), 'Remove old files under ~/.sc-agent');
});
