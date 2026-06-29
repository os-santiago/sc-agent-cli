import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileTool } from './read-file.js';
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

test('read_file explains when the requested path does not exist', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'sc-read-file-missing-'));

  try {
    await assert.rejects(
      () => readFileTool.execute({ path: 'missing.txt' }, { workspaceRoot, config }),
      /File not found: missing\.txt\. Check the path and use list_dir to inspect nearby files\./
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file suggests list_dir when the requested path is a directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'sc-read-file-dir-'));
  const docsDir = path.join(workspaceRoot, 'docs');

  try {
    await mkdir(docsDir);
    await writeFile(path.join(docsDir, 'guide.md'), '# guide', 'utf-8');

    await assert.rejects(
      () => readFileTool.execute({ path: 'docs' }, { workspaceRoot, config }),
      /Cannot read docs because it is a directory\. Use list_dir to inspect its contents\./
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
