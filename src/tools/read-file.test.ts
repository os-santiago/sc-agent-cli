import { test, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestPermission } from '../utils/permissions.js';
import { readFileTool } from './read-file.js';
import type { ToolContext } from './tool.js';
import type { ProjectConfig } from '../core/types.js';

// Mocked permission layer — read_file is auto-approved by design, so it never
// consults requestPermission; the mock proves that contract rather than driving
// prompts or touching the real config store.
vi.mock('../utils/permissions.js', () => ({
  requestPermission: vi.fn(async () => true),
}));

const requestPermissionMock = vi.mocked(requestPermission);

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'sc-read-file-'));
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
  readFileTool.execute(args, ctx ?? makeCtx());

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('read_file returns contents with a total line count', async () => {
  writeFileSync(path.join(ws, 'notes.txt'), 'alpha\nbeta\ngamma');
  const out = await exec({ path: 'notes.txt' });
  assert.equal(out, 'alpha\nbeta\ngamma\n\n[3 lines total]');
});

test('read_file paginates with offset and limit', async () => {
  writeFileSync(path.join(ws, 'log.txt'), 'l1\nl2\nl3\nl4\nl5');
  const out = await exec({ path: 'log.txt', offset: 2, limit: 2 });
  assert.match(out, /^l2\nl3/);
  assert.match(out, /\[2 lines shown, 5 total\. Use offset=4&limit=2 to read more\.\]/);
});

test('read_file reads from an offset to EOF when limit is omitted', async () => {
  writeFileSync(path.join(ws, 'log.txt'), 'l1\nl2\nl3\nl4\nl5');
  const out = await exec({ path: 'log.txt', offset: 4 });
  assert.match(out, /^l4\nl5/);
  assert.match(out, /2 lines shown, 5 total/);
});

// ---------------------------------------------------------------------------
// Denied-path — mocked permission layer
// ---------------------------------------------------------------------------

test('denied-path: read_file surfaces Access denied under a denying permission layer', async () => {
  requestPermissionMock.mockResolvedValue(false);
  writeFileSync(path.join(ws, '.env'), 'SECRET=x');
  // The documented denied-result shape for this tool is the path-security
  // error — requestPermission is never consulted (auto-approved by design).
  await assert.rejects(
    exec({ path: '.env' }, makeCtx({ permissions: { denyPaths: ['.env'] } })),
    /matches a deny pattern/,
  );
  assert.equal(requestPermissionMock.mock.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Path security (resolveSafePath)
// ---------------------------------------------------------------------------

test('read_file rejects deny-listed paths', async () => {
  writeFileSync(path.join(ws, 'secrets.txt'), 'x');
  await assert.rejects(
    exec({ path: 'secrets.txt' }, makeCtx({ permissions: { denyPaths: ['secrets.txt'] } })),
    /Access denied/,
  );
});

test('read_file rejects paths outside the workspace', async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'sc-readfile-out-'));
  try {
    const target = path.join(outsideDir, 'outside.txt');
    writeFileSync(target, 'outside');
    await assert.rejects(exec({ path: target }), /outside the workspace/);
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Argument, pagination & size validation
// ---------------------------------------------------------------------------

test('read_file requires a path', async () => {
  await assert.rejects(exec({}), /Missing required argument: path/);
});

test('read_file rejects an offset below 1', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'a\nb\n');
  await assert.rejects(exec({ path: 'f.txt', offset: -1 }), /offset must be >= 1/);
});

test('read_file rejects an offset beyond the file length', async () => {
  writeFileSync(path.join(ws, 'f.txt'), 'a\nb\nc');
  await assert.rejects(
    exec({ path: 'f.txt', offset: 10 }),
    /Offset 10 exceeds file length \(3 lines\)/,
  );
});

test('read_file enforces maxReadFileBytes', async () => {
  writeFileSync(path.join(ws, 'big.txt'), '0123456789');
  await assert.rejects(
    exec({ path: 'big.txt' }, makeCtx({ settings: { maxReadFileBytes: 4 } })),
    /File too large/,
  );
});

test('read_file propagates a missing-file error', async () => {
  await assert.rejects(exec({ path: 'ghost.txt' }), /ENOENT/);
});
