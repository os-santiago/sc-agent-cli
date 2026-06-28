import test from 'node:test';
import assert from 'node:assert/strict';
import { getStorageGuidanceLines, getStorageLimitCommand } from './storage-limit.js';

test('getStorageLimitCommand returns PowerShell syntax on Windows', () => {
  assert.equal(getStorageLimitCommand('win32'), '$env:SC_MAX_STORAGE_GB="2"');
});

test('getStorageLimitCommand returns POSIX syntax outside Windows', () => {
  assert.equal(getStorageLimitCommand('linux'), 'export SC_MAX_STORAGE_GB=2');
});

test('getStorageGuidanceLines includes the config directory and guided cleanup tip', () => {
  const guidance = getStorageGuidanceLines('/tmp/.sc-agent', 'linux');

  assert.deepEqual(guidance, [
    'Increase limit: export SC_MAX_STORAGE_GB=2',
    'Review stored files in: /tmp/.sc-agent',
    'Use /storage for guided cleanup when needed',
  ]);
});
