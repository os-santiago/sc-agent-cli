import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('resolveSafePath denies access when workspace root does not exist', () => {
  assert.throws(
    () => resolveSafePath('some-file', 'C:\\nonexistent-workspace', config),
    /cannot resolve workspace root/
  );
});

test('resolveSafePath rejects paths outside workspace', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'sc-agent-ws-'));
  assert.throws(
    () => resolveSafePath('../etc/passwd', ws, config),
    /outside the workspace/
  );
});

test('resolveSafePath rejects deny-listed files', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'sc-agent-ws-'));
  await writeFile(path.join(ws, '.env'), 'SECRET=value');
  assert.throws(
    () => resolveSafePath('.env', ws, config),
    /matches a deny pattern/
  );
});

test('resolveSafePath allows files within workspace', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'sc-agent-ws-'));
  await writeFile(path.join(ws, 'safe.txt'), 'hello');
  const result = resolveSafePath('safe.txt', ws, config);
  assert.equal(result, path.resolve(ws, 'safe.txt'));
});
