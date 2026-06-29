import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { listDirTool } from './list-dir.js';
import type { ToolContext } from './tool.js';

const ctxConfig = {
  model: {
    provider: 'openai-compatible' as const,
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
};

test('list_dir explains when the target path does not exist', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'sc-list-dir-missing-'));
  const ctx: ToolContext = {
    workspaceRoot,
    config: ctxConfig,
  };

  try {
    await assert.rejects(
      () => listDirTool.execute({ path: 'missing-folder' }, ctx),
      /Directory not found: "missing-folder"[\s\S]*Use "\." for the current directory/
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('list_dir explains when the target path is a file', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'sc-list-dir-file-'));
  const ctx: ToolContext = {
    workspaceRoot,
    config: ctxConfig,
  };

  try {
    await writeFile(path.join(workspaceRoot, 'notes.txt'), 'hello', 'utf-8');

    await assert.rejects(
      () => listDirTool.execute({ path: 'notes.txt' }, ctx),
      /Cannot list "notes\.txt" because it is a file, not a directory[\s\S]*Use read_file/
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
