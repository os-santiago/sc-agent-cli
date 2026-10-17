import { test, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestPermission } from '../utils/permissions.js';
import { editFileTool } from './edit-file.js';
import type { ToolContext } from './tool.js';
import type { ProjectConfig } from '../core/types.js';

// Mocked permission layer — tests drive approval/denial explicitly instead of
// hitting the interactive prompt or the real config store.
vi.mock('../utils/permissions.js', () => ({
  requestPermission: vi.fn(async () => true),
}));

const requestPermissionMock = vi.mocked(requestPermission);

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'sc-edit-file-'));
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
  editFileTool.execute(args, ctx ?? makeCtx());

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('edit_file applies a unified diff patch', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'one\ntwo\nthree\n');
  const patch = '@@ -1,3 +1,3 @@\n one\n-two\n+dos\n three\n';
  const out = await exec({ path: 'f.txt', patch });
  assert.equal(out, 'Patch applied successfully: f.txt');
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf-8'), 'one\ndos\nthree\n');
  assert.equal(requestPermissionMock.mock.calls.length, 1);
  assert.equal(requestPermissionMock.mock.calls[0][0].toolName, 'edit_file');
});

test('edit_file applies a patch with ---/+++ file headers', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'alpha\nbeta\n');
  const patch = '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n-alpha\n+ALPHA\n beta\n';
  const out = await exec({ path: 'f.txt', patch });
  assert.equal(out, 'Patch applied successfully: f.txt');
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf-8'), 'ALPHA\nbeta\n');
});

// ---------------------------------------------------------------------------
// Denied-path — mocked permission layer
// ---------------------------------------------------------------------------

test('denied-path: edit_file aborts when the permission layer denies', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'original\n');
  requestPermissionMock.mockResolvedValue(false);
  await assert.rejects(
    exec({ path: 'f.txt', patch: '@@ -1,1 +1,1 @@\n-original\n+changed\n' }),
    /Permission denied by user/,
  );
  // Denial leaves the file untouched.
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf-8'), 'original\n');
  assert.equal(requestPermissionMock.mock.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Path security (resolveSafePath)
// ---------------------------------------------------------------------------

test('edit_file rejects deny-listed paths', async () => {
  mkdirSync(path.join(ws, 'secrets'));
  writeFileSync(path.join(ws, 'secrets', 'key.pem'), 'x\n');
  const ctx = makeCtx({ permissions: { denyPaths: ['secrets/**'] } });
  await assert.rejects(
    exec({ path: 'secrets/key.pem', patch: '@@ -1,1 +1,1 @@\n-x\n+y\n' }, ctx),
    /matches a deny pattern/,
  );
  assert.equal(readFileSync(path.join(ws, 'secrets', 'key.pem'), 'utf-8'), 'x\n');
});

test('edit_file rejects paths outside the workspace', async () => {
  await assert.rejects(
    exec({ path: '../outside.txt', patch: '@@ -1,1 +1,1 @@\n-a\n+b\n' }),
    /outside the workspace/,
  );
});

// ---------------------------------------------------------------------------
// Diff-patching error paths
// ---------------------------------------------------------------------------

test('edit_file reports a malformed patch without @@ hunk headers', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'a\nb\n');
  // parsePatch accepts the '@@' marker but yields a hunk with NaN anchors —
  // applyPatch returns false and the tool classifies it as a format error.
  await assert.rejects(
    exec({ path: 'f.txt', patch: '@@ broken hunk header\n-a\n+b\n' }),
    /invalid unified diff format/,
  );
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf-8'), 'a\nb\n');
});

test('edit_file reports a content mismatch when the patch cannot apply', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'alpha\nbeta\ngamma\n');
  const patch = '@@ -1,3 +1,3 @@\n alpha\n-omega\n+delta\n gamma\n';
  await assert.rejects(
    exec({ path: 'f.txt', patch }),
    (err: Error) => {
      assert.match(err.message, /Patch does not match file content/);
      assert.match(err.message, /First lines of patch/);
      assert.match(err.message, /-omega/);
      return true;
    },
  );
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf-8'), 'alpha\nbeta\ngamma\n');
});

test('edit_file resolves an ambiguous hunk at the position nearest its header', async () => {
  // The hunk body fits at both line 1 and line 3; the declared start (line 3)
  // is tried first, so only the second pair is patched.
  writeFileSync(path.join(ws, 'f.txt'), 'x\ny\nx\ny\n');
  const out = await exec({ path: 'f.txt', patch: '@@ -3,2 +3,2 @@\n x\n-y\n+z\n' });
  assert.equal(out, 'Patch applied successfully: f.txt');
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf-8'), 'x\ny\nx\nz\n');
});

test('edit_file fails when competing hunks leave no valid position', async () => {
  // Hunk 1 anchors at the "a\nc" pair (line 4); hunk 2's "a\nb" body also fits
  // at line 2, but patch hunks must not overlap already-claimed text, so the
  // ambiguous match surfaces as a failure instead of a corrupt apply.
  writeFileSync(path.join(ws, 'f.txt'), 'q\na\nb\na\nc\n');
  const patch = [
    '@@ -4,2 +4,2 @@',
    ' a',
    '-c',
    '+X',
    '@@ -3,2 +3,2 @@',
    ' a',
    '-b',
    '+Y',
    '',
  ].join('\n');
  await assert.rejects(
    exec({ path: 'f.txt', patch }),
    /Patch does not match file content/,
  );
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf-8'), 'q\na\nb\na\nc\n');
});

// ---------------------------------------------------------------------------
// Argument & filesystem errors
// ---------------------------------------------------------------------------

test('edit_file requires path and patch', async () => {
  await assert.rejects(exec({}), /Missing required arguments: path, patch/);
  await assert.rejects(exec({ path: 'f.txt' }), /Missing required arguments: path, patch/);
});

test('edit_file propagates a missing-file error', async () => {
  await assert.rejects(
    exec({ path: 'ghost.txt', patch: '@@ -1,1 +1,1 @@\n-a\n+b\n' }),
    /ENOENT/,
  );
});
