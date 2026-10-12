// list_dir tool coverage (#545, parent #544): execute() — default path,
// whitespace fallback, '~' expansion, [DIR]/[FILE] formatting and the empty
// directory marker — against a real tmp workspace. Read-only tool: no
// permission gate.

import { test, describe, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';
import { listDirTool } from './list-dir.js';

let dir: string;
let emptyDir: string;

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
  };
}

function ctx(): ToolContext {
  return { workspaceRoot: dir, config: makeConfig() };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-listdir-'));
  writeFileSync(join(dir, 'alpha.txt'), 'x');
  mkdirSync(join(dir, 'sub'));
  emptyDir = mkdtempSync(join(tmpdir(), 'sc-listdir-empty-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

describe('list_dir', () => {
  test('defaults to "." and formats files vs directories', async () => {
    const out = await listDirTool.execute({}, ctx());
    assert.match(out, /\[FILE\] alpha\.txt/);
    assert.match(out, /\[DIR\] sub/);
  });

  test('a blank path falls back to "."', async () => {
    const out = await listDirTool.execute({ path: '   ' }, ctx());
    assert.match(out, /\[FILE\] alpha\.txt/);
  });

  test('a subdirectory path lists that directory', async () => {
    writeFileSync(join(dir, 'sub', 'inside.txt'), 'y');
    const out = await listDirTool.execute({ path: 'sub' }, ctx());
    assert.match(out, /\[FILE\] inside\.txt/);
  });

  test('empty directories report the marker', async () => {
    const out = await listDirTool.execute(
      { path: '.' },
      { workspaceRoot: emptyDir, config: makeConfig() },
    );
    assert.equal(out, '(empty directory)');
  });

  test('"~" resolves to the home directory — which is outside the workspace and refused', async () => {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
      await assert.rejects(
        listDirTool.execute({ path: '~' }, ctx()),
        /outside the workspace/,
      );
    } else {
      // No HOME/USERPROFILE → '~' collapses to '' → the '.' fallback lists the workspace.
      const out = await listDirTool.execute({ path: '~' }, ctx());
      assert.match(out, /\[FILE\] alpha\.txt/);
    }
  });
});
