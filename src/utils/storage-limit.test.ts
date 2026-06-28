import test from 'node:test';
import assert from 'node:assert/strict';
import { getStorageGuidance } from './storage-limit.js';

test('getStorageGuidance returns PowerShell commands on Windows', () => {
  const guidance = getStorageGuidance('C:\\Users\\test\\.sc-agent', 'win32');

  assert.equal(guidance.setLimitCommand, '$env:SC_MAX_STORAGE_GB = "2"');
  assert.equal(
    guidance.cleanupCommand,
    'Remove-Item -Recurse -Force "C:\\Users\\test\\.sc-agent\\old-files"'
  );
});

test('getStorageGuidance returns POSIX shell commands on Unix-like platforms', () => {
  const guidance = getStorageGuidance('/home/test/.sc-agent', 'linux');

  assert.equal(guidance.setLimitCommand, 'export SC_MAX_STORAGE_GB=2');
  assert.equal(guidance.cleanupCommand, 'rm -rf "/home/test/.sc-agent/old-files"');
});
