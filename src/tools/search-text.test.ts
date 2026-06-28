import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { searchTextTool } from './search-text.js';
import type { ToolContext } from './tool.js';

const config = {
  model: {
    provider: 'openai-compatible' as const,
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
};

test('search_text returns workspace-relative paths', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-search-text-'));
  const nestedDir = path.join(workspaceRoot, 'src');
  const filePath = path.join(nestedDir, 'example.ts');
  await mkdir(nestedDir, { recursive: true });
  await writeFile(filePath, 'const greeting = "hello world";\n', 'utf-8');

  const ctx: ToolContext = {
    workspaceRoot,
    config,
  };

  const result = await searchTextTool.execute({ pattern: 'hello', glob: '**/*.ts' }, ctx);
  assert.match(result, /^src[\\/]example\.ts:\n/m);
  assert.doesNotMatch(result, new RegExp(workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('search_text surfaces invalid regex patterns clearly', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-search-text-'));
  const ctx: ToolContext = {
    workspaceRoot,
    config,
  };

  await assert.rejects(
    () => searchTextTool.execute({ pattern: '[', regex: true }, ctx),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid regex pattern "\["/);
      return true;
    }
  );
});
