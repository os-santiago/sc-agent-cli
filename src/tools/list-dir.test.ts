import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listDirTool } from './list-dir.js';
import type { ProjectConfig } from '../core/types.js';

const config: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
  permissions: {},
};

test('list_dir shows directories first with stable alphabetical ordering', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-list-dir-'));

  try {
    await mkdir(path.join(workspaceRoot, 'zeta'));
    await mkdir(path.join(workspaceRoot, 'Alpha'));
    await writeFile(path.join(workspaceRoot, 'beta.txt'), 'beta', 'utf-8');
    await writeFile(path.join(workspaceRoot, 'Gamma.txt'), 'gamma', 'utf-8');

    const result = await listDirTool.execute({ path: '.' }, { workspaceRoot, config });

    assert.equal(
      result,
      [
        '[DIR] Alpha',
        '[DIR] zeta',
        '[FILE] beta.txt',
        '[FILE] Gamma.txt',
      ].join('\n')
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
