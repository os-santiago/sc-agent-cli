import test from 'node:test';
import assert from 'node:assert/strict';
import { getStorageGuidance } from './storage-guidance.js';

test('getStorageGuidance returns PowerShell-friendly tips on Windows', () => {
  const tips = getStorageGuidance('win32');

  assert.deepEqual(tips, [
    '  • Increase limit: $env:SC_MAX_STORAGE_GB = "2"',
    '  • Clean manually: Remove-Item "$HOME\\.sc-agent\\old-files" -Recurse -Force',
    '  • Auto-cleanup runs when limit is exceeded',
  ]);
});

test('getStorageGuidance returns POSIX-friendly tips on non-Windows platforms', () => {
  const linuxTips = getStorageGuidance('linux');
  const darwinTips = getStorageGuidance('darwin');

  assert.deepEqual(linuxTips, [
    '  • Increase limit: export SC_MAX_STORAGE_GB=2',
    '  • Clean manually: rm -rf ~/.sc-agent/old-files',
    '  • Auto-cleanup runs when limit is exceeded',
  ]);
  assert.deepEqual(darwinTips, linuxTips);
});
