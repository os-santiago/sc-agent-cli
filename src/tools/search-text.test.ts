import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { searchTextTool } from './search-text.js';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';

const config: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
};

test('search_text explains how to recover from an invalid regex pattern', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-search-text-'));

  try {
    const ctx: ToolContext = { workspaceRoot, config };

    await assert.rejects(
      () => searchTextTool.execute({ pattern: '[abc', regex: true }, ctx),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid regex pattern "\[abc":/);
        assert.match(error.message, /Use regex=false to search for this text literally\./);
        return true;
      }
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('search_text still supports literal searches for regex-like text', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-search-text-'));

  try {
    await writeFile(path.join(workspaceRoot, 'notes.txt'), 'literal [abc marker', 'utf-8');

    const ctx: ToolContext = { workspaceRoot, config };
    const result = await searchTextTool.execute({ pattern: '[abc', regex: false }, ctx);

    assert.match(result, /notes\.txt:/);
    assert.match(result, /1: literal \[abc marker/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
