// read_file tool coverage (#545, parent #544): the execute() body — arg
// validation, safe-path resolution, the size cap, offset/limit slicing and
// the "lines shown / total" trailer — against real fixture files in a tmp
// workspace. read_file is read-only: it does not pass through
// requestPermission, so no prompt mocks are needed here.

import { test, describe, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';
import { readFileTool } from './read-file.js';

let dir: string;

function makeConfig(maxReadFileBytes?: number): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    ...(maxReadFileBytes !== undefined ? { settings: { maxReadFileBytes } } : {}),
  };
}

function ctx(config: ProjectConfig = makeConfig()): ToolContext {
  return { workspaceRoot: dir, config };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-readfile-'));
  // No trailing newline — split('\n') must count exactly 5 lines.
  writeFileSync(join(dir, 'five.txt'), 'a\nb\nc\nd\ne');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('read_file', () => {
  test('requires path', async () => {
    await assert.rejects(readFileTool.execute({}, ctx()), /Missing required argument: path/);
  });

  test('reads a whole file and reports the total line count', async () => {
    const out = await readFileTool.execute({ path: 'five.txt' }, ctx());
    assert.match(out, /^a\nb\nc\nd\ne/);
    assert.match(out, /\[5 lines total\]$/);
  });

  test('offset + limit slice the file and append a pagination hint', async () => {
    const out = await readFileTool.execute({ path: 'five.txt', offset: 2, limit: 2 }, ctx());
    assert.match(out, /^b\nc/);
    assert.match(out, /\[2 lines shown, 5 total\. Use offset=4&limit=2 to read more\.\]$/);
  });

  test('limit alone starts at line 1', async () => {
    const out = await readFileTool.execute({ path: 'five.txt', limit: 2 }, ctx());
    assert.match(out, /^a\nb/);
    assert.match(out, /\[2 lines shown, 5 total\./);
  });

  test('offset below 1 is rejected', async () => {
    // offset=0 would collapse to 1 via `|| 1`; only a negative value reaches
    // the `offset < 1` guard.
    await assert.rejects(
      readFileTool.execute({ path: 'five.txt', offset: -1 }, ctx()),
      /offset must be >= 1/,
    );
  });

  test('offset past the end is rejected with the file length', async () => {
    await assert.rejects(
      readFileTool.execute({ path: 'five.txt', offset: 99 }, ctx()),
      /Offset 99 exceeds file length \(5 lines\)/,
    );
  });

  test('files larger than maxReadFileBytes are rejected before reading', async () => {
    writeFileSync(join(dir, 'big.bin'), 'x'.repeat(64));
    await assert.rejects(
      readFileTool.execute({ path: 'big.bin' }, ctx(makeConfig(10))),
      /File too large.*Maximum read size/,
    );
  });

  test('paths outside the workspace are refused by resolveSafePath', async () => {
    await assert.rejects(
      readFileTool.execute({ path: '../../../../etc/hostname' }, ctx()),
      /outside the workspace/,
    );
  });

  test('a missing file surfaces the fs error', async () => {
    await assert.rejects(
      readFileTool.execute({ path: 'ghost.txt' }, ctx()),
      /ENOENT|no such file/i,
    );
  });
});
