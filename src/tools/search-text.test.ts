// search_text tool coverage (#545, parent #544): execute() — arg validation,
// the path/glob alias, plain + regex matching, the 50-file cap and the
// unreadable-file skip — against real fixture files in a tmp workspace.
// Read-only tool: no permission gate.
//
// node:fs/promises.readFile is wrapped so one fixture can be forced to fail
// mid-scan — that is the only deterministic cross-platform way to cover the
// "skip unreadable files" catch (fast-glob only returns regular files, and
// chmod-000/symlink tricks are not portable to Windows).

import { test, describe, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:fs/promises', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...mod,
    readFile: vi.fn(async (file: Parameters<typeof mod.readFile>[0], options?: never) => {
      if (String(file).endsWith('unreadable.txt')) {
        throw new Error('EACCES: simulated unreadable file');
      }
      return mod.readFile(file, options as never);
    }),
  };
});

import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';
import { searchTextTool } from './search-text.js';

let dir: string;

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
  };
}

function ctx(): ToolContext {
  return { workspaceRoot: dir, config: makeConfig() };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-searchtext-'));
  writeFileSync(join(dir, 'alpha.txt'), 'hello world\nsecond line\n');
  writeFileSync(join(dir, 'beta.txt'), 'nothing here\nHELLO again\n');
  writeFileSync(join(dir, 'gamma.md'), 'hello from markdown\n');
  writeFileSync(join(dir, 'unreadable.txt'), 'hello but unreadable\n');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('search_text', () => {
  test('requires pattern', async () => {
    await assert.rejects(searchTextTool.execute({}, ctx()), /Missing required argument: pattern/);
  });

  test('refuses to search without a path/glob', async () => {
    const out = await searchTextTool.execute({ pattern: 'hello' }, ctx());
    assert.match(out, /missing search path/);
  });

  test('plain search matches case-insensitively and reports file + line', async () => {
    const out = await searchTextTool.execute({ pattern: 'hello', glob: '*.txt' }, ctx());
    assert.match(out, /alpha\.txt/);
    assert.match(out, /1: hello world/);
    assert.match(out, /beta\.txt/);
    assert.match(out, /2: HELLO again/);
  });

  test('"path" is an alias for "glob"', async () => {
    const out = await searchTextTool.execute({ pattern: 'markdown', path: '*.md' }, ctx());
    assert.match(out, /gamma\.md/);
  });

  test('regex mode treats the pattern as a RegExp', async () => {
    const out = await searchTextTool.execute({ pattern: 'h.ll+', glob: '*.txt', regex: true }, ctx());
    assert.match(out, /alpha\.txt/);
  });

  test('no matches produces the empty-result message', async () => {
    const out = await searchTextTool.execute({ pattern: 'zzz-no-hit', glob: '*.txt' }, ctx());
    assert.equal(out, 'No matches found');
  });

  test('more than 50 matched files is refused with a narrowing hint', async () => {
    const manyDir = mkdtempSync(join(tmpdir(), 'sc-searchtext-many-'));
    try {
      for (let i = 0; i < 51; i++) {
        writeFileSync(join(manyDir, `f${String(i).padStart(3, '0')}.log`), 'needle\n');
      }
      const out = await searchTextTool.execute(
        { pattern: 'needle', glob: '*.log' },
        { workspaceRoot: manyDir, config: makeConfig() },
      );
      assert.match(out, /matched 51 files \(max 50\)/);
    } finally {
      rmSync(manyDir, { recursive: true, force: true });
    }
  });

  test('unreadable files are skipped instead of failing the search', async () => {
    const out = await searchTextTool.execute({ pattern: 'hello', glob: '*.txt' }, ctx());
    assert.match(out, /alpha\.txt/);
    // The forced EACCES fixture must not appear or abort the run.
    assert.ok(!out.includes('unreadable.txt'));
  });
});
