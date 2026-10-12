// edit_file tool coverage (#545, parent #544): execute() — arg validation,
// the requestPermission gate (deny + approve), a real unified-diff apply via
// the `diff` package, and the two failure disambiguations the tool makes:
// malformed patch vs. patch/context mismatch. Real fs under a tmp workspace.

import { test, describe, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';

// Same mock shapes as registry.test.ts — prompts approves by default.
vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

import prompts from 'prompts';
import { editFileTool } from './edit-file.js';
import { clearSessionPermissions } from '../utils/permissions.js';

let dir: string;

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    permissions: { autoApprove: [] },
  };
}

function ctx(autoApprove = true): ToolContext {
  return { workspaceRoot: dir, config: makeConfig(), autoApprove };
}

const VALID_PATCH = [
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,3 @@',
  ' alpha',
  '-beta',
  '+BETA',
  ' gamma',
  '',
].join('\n');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-editfile-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
  writeFileSync(join(dir, 'f.txt'), 'alpha\nbeta\ngamma\n');
});

describe('edit_file', () => {
  test('requires path and patch', async () => {
    await assert.rejects(editFileTool.execute({}, ctx()), /Missing required arguments: path, patch/);
    await assert.rejects(editFileTool.execute({ path: 'f.txt' }, ctx()), /Missing required arguments/);
  });

  test('a denied prompt rejects before touching the file', async () => {
    const context = ctx(false);
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      editFileTool.execute({ path: 'f.txt', patch: VALID_PATCH }, context),
      /Permission denied by user/,
    );
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf-8'), 'alpha\nbeta\ngamma\n');
  });

  test('an approved unified diff is applied and persisted', async () => {
    const out = await editFileTool.execute({ path: 'f.txt', patch: VALID_PATCH }, ctx());
    assert.match(out, /Patch applied successfully: f\.txt/);
    assert.equal(readFileSync(join(dir, 'f.txt'), 'utf-8'), 'alpha\nBETA\ngamma\n');
  });

  test('a well-formed patch that does not match reports "does not match"', async () => {
    writeFileSync(join(dir, 'mismatch.txt'), 'zzz\nyyy\nxxx\n');
    await assert.rejects(
      editFileTool.execute({ path: 'mismatch.txt', patch: VALID_PATCH }, ctx()),
      /Patch does not match file content in mismatch\.txt/,
    );
  });

  test('a patch without @@ -a,b +c,d @@ headers reports "invalid unified diff format"', async () => {
    // `@@ -1 +1 @@` is a spec-valid hunk header (counts default to 1) that the
    // `diff` package parses but cannot apply to mismatched content — while the
    // tool's stricter header regex (requiring counts) does not match it.
    const noCountsPatch = ['--- a/f.txt', '+++ b/f.txt', '@@ -1 +1 @@', '-zzz', '+new', ''].join('\n');
    await assert.rejects(
      editFileTool.execute({ path: 'f.txt', patch: noCountsPatch }, ctx()),
      /invalid unified diff format/,
    );
  });

  test('a missing target file surfaces the fs error', async () => {
    await assert.rejects(
      editFileTool.execute({ path: 'ghost.txt', patch: VALID_PATCH }, ctx()),
      /ENOENT|no such file/i,
    );
  });
});
