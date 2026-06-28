import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveSafePath } from './path-security.js';
import type { ProjectConfig } from '../core/types.js';

const config: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
  permissions: {
    denyPaths: ['.env'],
  },
};

test('resolveSafePath deny-pattern error points to the global config path', () => {
  assert.throws(
    () => resolveSafePath('.env', 'C:\\workspace', config),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        new RegExp(path.join(homedir(), '.sc-agent', 'config.json').replace(/\\/g, '\\\\'))
      );
      return true;
    }
  );
});
