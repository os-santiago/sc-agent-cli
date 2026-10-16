import { test, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestPermission } from '../utils/permissions.js';
import { listDirTool } from './list-dir.js';
import type { ToolContext } from './tool.js';
import type { ProjectConfig } from '../core/types.js';

// Mocked permission layer — list_dir is auto-approved by design, so it never
// consults requestPermission; the mock proves that contract rather than driving
// prompts or touching the real config store.
vi.mock('../utils/permissions.js', () => ({
  requestPermission: vi.fn(async () => true),
}));

const requestPermissionMock = vi.mocked(requestPermission);

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'sc-list-dir-'));
  requestPermissionMock.mockReset();
  requestPermissionMock.mockResolvedValue(true);
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<ProjectConfig> = {}): ToolContext {
  const config: ProjectConfig = {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://provider.test/v1',
      model: 'test-model',
    },
    ...overrides,
  };
  return { workspaceRoot: ws, config };
}

const exec = (args: Record<string, unknown>, ctx?: ToolContext) =>
  listDirTool.execute(args, ctx ?? makeCtx());

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('list_dir formats entries with DIR/FILE markers', async () => {
  mkdirSync(path.join(ws, 'subdir'));
  writeFileSync(path.join(ws, 'a.txt'), 'x');
  const out = await exec({ path: '.' });
  assert.match(out, /\[DIR\] subdir/);
  assert.match(out, /\[FILE\] a\.txt/);
});

test('list_dir lists the workspace root for ".", missing, or blank paths', async () => {
  writeFileSync(path.join(ws, 'marker.txt'), 'x');
  for (const args of [{ path: '.' }, { path: '' }, { path: '   ' }, {}]) {
    assert.match(await exec(args), /marker\.txt/);
  }
});

test('list_dir reports an empty directory', async () => {
  mkdirSync(path.join(ws, 'empty'));
  assert.equal(await exec({ path: 'empty' }), '(empty directory)');
});

// ---------------------------------------------------------------------------
// Denied-path — mocked permission layer
// ---------------------------------------------------------------------------

test('denied-path: list_dir surfaces Access denied under a denying permission layer', async () => {
  requestPermissionMock.mockResolvedValue(false);
  mkdirSync(path.join(ws, 'protected'));
  // The documented denied-result shape for this tool is the path-security
  // error — requestPermission is never consulted (auto-approved by design).
  await assert.rejects(
    exec({ path: 'protected' }, makeCtx({ permissions: { denyPaths: ['protected'] } })),
    /matches a deny pattern/,
  );
  assert.equal(requestPermissionMock.mock.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Path security (resolveSafePath)
// ---------------------------------------------------------------------------

test('list_dir rejects paths outside the workspace', async () => {
  await assert.rejects(exec({ path: '..' }), /outside the workspace/);
});

// "~" expands to HOME/USERPROFILE, which never resolves inside the temp
// workspace — deterministic "Access denied" unless the host has no home var.
const hasHome = Boolean(process.env.HOME || process.env.USERPROFILE);
test.skipIf(!hasHome)('list_dir resolves "~" to a home dir outside the workspace', async () => {
  await assert.rejects(exec({ path: '~' }), /Access denied/);
});

// ---------------------------------------------------------------------------
// Filesystem errors
// ---------------------------------------------------------------------------

test('list_dir propagates readdir errors for non-directories', async () => {
  writeFileSync(path.join(ws, 'file.txt'), 'x');
  await assert.rejects(exec({ path: 'file.txt' }), /ENOTDIR|not a directory/);
});
