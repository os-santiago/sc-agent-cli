import test from 'node:test';
import assert from 'node:assert/strict';
import { getInfoSummaryRows } from './chat-session.js';
import type { ProjectConfig } from '../core/types.js';

test('getInfoSummaryRows labels permission profile distinctly', () => {
  const config: ProjectConfig = {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'demo-model',
    },
    activeProfile: 'work',
    permissions: {
      profile: 'blacklist',
      autoApprove: ['read_file', 'search_text'],
    },
  };

  const rows = getInfoSummaryRows(config, 'ask_once', 3);
  const labels = rows.map((row) => row.label);

  assert.deepEqual(labels, [
    'Profile',
    'Model',
    'Provider',
    'Temperature',
    'Max Tokens',
    'Permissions',
    'Permission Profile',
    'Auto-approve',
    'History',
  ]);

  assert.equal(rows.find((row) => row.label === 'Permission Profile')?.value, 'Blacklist (smart)');
  assert.equal(rows.find((row) => row.label === 'Permissions')?.value, 'Ask once per command');
  assert.equal(rows.find((row) => row.label === 'Auto-approve')?.value, 'read_file, search_text');
});
