import test from 'node:test';
import assert from 'node:assert/strict';
import { getInfoDisplayRows } from './chat-session.js';
import type { ProjectConfig } from '../core/types.js';

function createConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'demo-model',
      temperature: 0.2,
      maxTokens: 2048,
    },
    permissions: {
      autoApprove: ['read_file', 'list_dir'],
      profile: 'blacklist',
    },
    activeProfile: 'demo',
    ...overrides,
  };
}

test('getInfoDisplayRows uses explicit labels for chat /info output', () => {
  const rows = getInfoDisplayRows(createConfig(), 'ask_once', 3);
  const labels = rows.map((row) => row.label);

  assert.deepEqual(labels, [
    'Active Profile',
    'Model',
    'Provider',
    'Temperature',
    'Max Tokens',
    'Permission Mode',
    'Permission Profile',
    'Auto-approve',
    'History',
  ]);
  assert.equal(rows.find((row) => row.label === 'Permission Profile')?.value, 'Blacklist (smart)');
  assert.equal(rows.find((row) => row.label === 'Permission Mode')?.value, 'Ask once per command');
});

test('getInfoDisplayRows omits auto-approve row when no tools are configured', () => {
  const rows = getInfoDisplayRows(
    createConfig({
      permissions: {
        autoApprove: [],
        profile: 'traditional',
      },
    }),
    'always_ask',
    0
  );

  assert.equal(rows.some((row) => row.label === 'Auto-approve'), false);
  assert.equal(rows.find((row) => row.label === 'Permission Profile')?.value, 'Traditional');
  assert.equal(rows.find((row) => row.label === 'Permission Mode')?.value, 'Always ask (safer)');
});
