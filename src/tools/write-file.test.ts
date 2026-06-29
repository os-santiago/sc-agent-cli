import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeFileTool } from './write-file.js';
import type { ProjectConfig } from '../core/types.js';

const testConfig: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'test-model',
  },
};

test('writeFileTool explains when the target path is a directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'sc-write-file-test-'));

  try {
    await mkdir(path.join(workspaceRoot, 'docs'));

    await assert.rejects(
      () => writeFileTool.execute(
        { path: 'docs', content: 'hello' },
        { workspaceRoot, config: testConfig, autoApprove: true }
      ),
      /Cannot write to "docs" because it is a directory\.[\s\S]*Provide a file path instead/
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
