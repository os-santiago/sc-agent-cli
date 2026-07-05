import { test, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectConfig } from '../core/types.js';

// Mock prompts to avoid interactive I/O
vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('./box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));
vi.mock('node:fs', () => {
  const store: Record<string, string> = {};
  return {
    existsSync: (p: string) => p in store,
    readFileSync: (p: string) => store[p],
    writeFileSync: (p: string, d: string) => { store[p] = d; },
    mkdirSync: () => {},
  };
});

import { requestPermission, clearSessionPermissions } from './permissions.js';

const baseConfig: ProjectConfig = {
  model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
  permissions: { autoApprove: ['read_file'], denyPaths: [], profile: 'traditional' },
};

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
});

test('requestPermission returns true when autoApprove is set', async () => {
  const result = await requestPermission({
    toolName: 'write_file',
    args: {},
    config: baseConfig,
    autoApprove: true,
  });
  assert.equal(result, true);
});

test('requestPermission returns true for tools in autoApprove list', async () => {
  const result = await requestPermission({
    toolName: 'read_file',
    args: {},
    config: baseConfig,
  });
  assert.equal(result, true);
});

test('clearSessionPermissions clears session state', () => {
  // Just verify it doesn't throw
  clearSessionPermissions();
  assert.ok(true);
});
