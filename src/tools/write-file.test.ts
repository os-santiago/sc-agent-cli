import { test, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestPermission } from '../utils/permissions.js';
import { writeFileTool } from './write-file.js';
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
  ws = mkdtempSync(path.join(tmpdir(), 'sc-write-file-'));
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
  writeFileTool.execute(args, ctx ?? makeCtx());

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('write_file writes content and creates missing parent directories', async () => {
  const out = await exec({ path: 'a/b/out.txt', content: 'hello world' });
  assert.equal(out, 'File written successfully: a/b/out.txt');
  assert.equal(readFileSync(path.join(ws, 'a/b/out.txt'), 'utf-8'), 'hello world');
  assert.equal(requestPermissionMock.mock.calls.length, 1);
  assert.equal(requestPermissionMock.mock.calls[0][0].toolName, 'write_file');
});

test('write_file overwrites an existing file', async () => {
  const target = path.join(ws, 'existing.txt');
  writeFileSync(target, 'old contents');
  const out = await exec({ path: 'existing.txt', content: 'new contents' });
  assert.equal(out, 'File written successfully: existing.txt');
  assert.equal(readFileSync(target, 'utf-8'), 'new contents');
});

test('write_file accepts empty content', async () => {
  const out = await exec({ path: 'empty.txt', content: '' });
  assert.equal(out, 'File written successfully: empty.txt');
  assert.equal(readFileSync(path.join(ws, 'empty.txt'), 'utf-8'), '');
});

// ---------------------------------------------------------------------------
// Denied-path — mocked permission layer
// ---------------------------------------------------------------------------

test('denied-path: write_file aborts when the permission layer denies', async () => {
  requestPermissionMock.mockResolvedValue(false);
  await assert.rejects(
    exec({ path: 'nope.txt', content: 'x' }),
    /Permission denied by user/,
  );
  // Denial leaves no file behind.
  assert.equal(existsSync(path.join(ws, 'nope.txt')), false);
  assert.equal(requestPermissionMock.mock.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Path security (resolveSafePath)
// ---------------------------------------------------------------------------

test('write_file rejects deny-listed paths', async () => {
  const ctx = makeCtx({ permissions: { denyPaths: ['.env', 'secrets/**'] } });
  await assert.rejects(exec({ path: '.env', content: 'x' }, ctx), /matches a deny pattern/);
  await assert.rejects(
    exec({ path: 'secrets/key.pem', content: 'x' }, ctx),
    /matches a deny pattern/,
  );
  assert.equal(existsSync(path.join(ws, '.env')), false);
  assert.equal(existsSync(path.join(ws, 'secrets', 'key.pem')), false);
});

test('write_file rejects paths outside the workspace', async () => {
  await assert.rejects(
    exec({ path: '../escape.txt', content: 'x' }),
    /outside the workspace/,
  );
  assert.equal(existsSync(path.join(path.dirname(ws), 'escape.txt')), false);
});

// ---------------------------------------------------------------------------
// Argument & size validation
// ---------------------------------------------------------------------------

test('write_file requires path and content', async () => {
  await assert.rejects(exec({}), /Missing required arguments: path, content/);
  await assert.rejects(exec({ path: 'x.txt' }), /Missing required arguments: path, content/);
});

test('write_file enforces maxWriteFileBytes before consulting the permission layer', async () => {
  const ctx = makeCtx({ settings: { maxWriteFileBytes: 8 } });
  await assert.rejects(
    exec({ path: 'big.txt', content: '0123456789' }, ctx),
    /Content too large/,
  );
  assert.equal(requestPermissionMock.mock.calls.length, 0);
  assert.equal(existsSync(path.join(ws, 'big.txt')), false);
});
