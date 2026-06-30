import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { searchTextTool } from './search-text.js';
import type { ToolContext } from './tool.js';

function createContext(workspaceRoot: string): ToolContext {
  return {
    workspaceRoot,
    config: {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'test-model',
      },
    },
  };
}

test('search_text explains when a glob matches no files', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-search-text-'));

  const result = await searchTextTool.execute(
    { pattern: 'needle', glob: '**/*.ts' },
    createContext(workspaceRoot)
  );

  assert.equal(result, 'No files matched glob "**/*.ts". Check the pattern and try again.');
});

test('search_text still reports no matches when files were searched', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-search-text-'));
  await writeFile(path.join(workspaceRoot, 'example.txt'), 'haystack only', 'utf-8');

  const result = await searchTextTool.execute(
    { pattern: 'needle', glob: '**/*.txt' },
    createContext(workspaceRoot)
  );

  assert.equal(result, 'No matches found');
});
