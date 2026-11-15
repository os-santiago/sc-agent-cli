import { test, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestPermission } from '../utils/permissions.js';
import { editFileTool } from './edit-file.js';
import type { ToolContext } from './tool.js';
import type { ProjectConfig } from '../core/types.js';
import { createPatch } from 'diff';

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

function snapshotFile(target: string) {
  const fd = openSync(target, 'r');
  try {
    return { content: readFileSync(fd, 'utf8'), mtimeNs: fstatSync(fd, { bigint: true }).mtimeNs };
  } finally {
    closeSync(fd);
  }
}

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

test('edit_file rejects out-of-order hunks', async () => {
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
    /invalid unified diff format/,
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

// A rejected tool call must neither report a mutation nor rewrite the original.
// Give the file an old mtime so writing identical bytes is observable too.
test.each([
  ['plain text', 'replace alpha with beta', /invalid unified diff format/],
  ['headers only', '--- a/f.txt\n+++ b/f.txt\n', /invalid unified diff format/],
  ['escaped transport newlines', '@@ -1 +1 @@\\n-alpha\\n+beta\\n', /invalid unified diff format/],
  ['incorrect line counts', '@@ -1,2 +1,2 @@\n-alpha\n+beta\n', /invalid unified diff format/],
  ['invalid hunk anchors', '@@ broken\n-alpha\n+beta\n', /invalid unified diff format/],
  ['unsafe integer anchors', '@@ -9007199254740992 +1 @@\n-alpha\n+beta\n', /invalid unified diff format/],
  ['anchors far beyond EOF', '@@ -1000000000 +1 @@\n-alpha\n+beta\n', /Patch does not match file content/],
  ['omitted body with nonzero count', '@@ -1 +1 @@\n+beta\n', /invalid unified diff format/],
  ['context-only hunk', '@@ -1 +1 @@\n alpha\n', /produces no changes/],
  ['identical replacement', '@@ -1 +1 @@\n-alpha\n+alpha\n', /produces no changes/],
  ['multiple files', '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-alpha\n+beta\n--- a/g.txt\n+++ b/g.txt\n@@ -1 +1 @@\n-x\n+y\n', /invalid unified diff format/],
])('edit_file rejects %s without writing', async (_name, patch, error) => {
  const target = path.join(ws, 'f.txt');
  writeFileSync(target, 'alpha\n');
  utimesSync(target, new Date('2000-01-01'), new Date('2000-01-01'));
  const before = snapshotFile(target);
  await assert.rejects(exec({ path: 'f.txt', patch }), error);
  assert.deepEqual(snapshotFile(target), before);
});

test.each([
  { path: 42, patch: 'patch' },
  { path: 'f.txt', patch: ['patch'] },
  { path: {}, patch: 'patch' },
])('edit_file rejects non-string arguments before permissions: %j', async (args) => {
  await assert.rejects(exec(args), /must be non-empty strings/);
  assert.equal(requestPermissionMock.mock.calls.length, 0);
});

test('edit_file supports abbreviated hunk headers and preserves literal escapes', async () => {
  writeFileSync(path.join(ws, 'f.txt'), String.raw`const text = "old\\nvalue";` + '\n');
  const patch = ['@@ -1 +1 @@', String.raw`-const text = "old\\nvalue";`, String.raw`+const text = "new\\nvalue";`, ''].join('\n');
  assert.match(await exec({ path: 'f.txt', patch }), /Patch applied successfully/);
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf8'), String.raw`const text = "new\\nvalue";` + '\n');
});

test.each([
  ['', '@@ -0,0 +1 @@\n+beta\n', 'beta\n'],
  ['alpha\n', '@@ -1 +0,0 @@\n-alpha\n', ''],
])('edit_file supports explicit zero-line ranges: %j', async (original, patch, expected) => {
  writeFileSync(path.join(ws, 'f.txt'), original);
  await exec({ path: 'f.txt', patch });
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf8'), expected);
});

test('edit_file preserves the explicit missing-final-newline marker', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'alpha');
  const patch = '@@ -1 +1 @@\n-alpha\n\\ No newline at end of file\n+beta\n\\ No newline at end of file\n';
  await exec({ path: 'f.txt', patch });
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf8'), 'beta');
});

test.each([
  ['alpha\r\n', 'beta\r\n'],
  ['alpha\r\n', 'beta'],
  ['alpha', 'beta\n'],
  ['alpha\nbeta\n', 'alpha\nβeta😀'],
  ['alpha\n\n', 'beta\n\n'],
  ['a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk', 'A\nb\nc\nd\ne\nf\ng\nh\ni\nj\nK'],
])('edit_file preserves generated patch semantics: %j', async (original, expected) => {
  writeFileSync(path.join(ws, 'f.txt'), original);
  await exec({ path: 'f.txt', patch: createPatch('f.txt', original, expected, undefined, undefined, { context: 1 }) });
  assert.equal(readFileSync(path.join(ws, 'f.txt'), 'utf8'), expected);
});

test.each([
  ['alpha\ntail\n\n', '@@ -1,2 +1,2 @@\n-alpha\n+beta\n\\ No newline at end of file\n tail\n', /invalid unified diff format/],
  ['alpha\ntail\n', '@@ -1 +1 @@\n-alpha\n+beta\n\\ No newline at end of file\n', /EOF marker does not refer/],
  ['alpha\n', '@@ -1 +1 @@\n-alpha\n\\ No newline at end of file\n+beta\n', /original file has a final newline/],
])('edit_file rejects misplaced EOF declarations without writing: %j', async (original, patch, error) => {
  const target = path.join(ws, 'f.txt');
  writeFileSync(target, original);
  utimesSync(target, new Date('2000-01-01'), new Date('2000-01-01'));
  const before = snapshotFile(target);
  await assert.rejects(exec({ path: 'f.txt', patch }), error);
  assert.deepEqual(snapshotFile(target), before);
});
