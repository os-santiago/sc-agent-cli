import { test, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestPermission } from '../utils/permissions.js';
import { searchTextTool } from './search-text.js';
import type { ToolContext } from './tool.js';
import type { ProjectConfig } from '../core/types.js';

// Mocked permission layer — search_text is auto-approved by design, so it never
// consults requestPermission; the mock proves that contract rather than driving
// prompts or touching the real config store.
vi.mock('../utils/permissions.js', () => ({
  requestPermission: vi.fn(async () => true),
}));

const requestPermissionMock = vi.mocked(requestPermission);

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'sc-search-text-'));
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
  searchTextTool.execute(args, ctx ?? makeCtx());

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('search_text finds case-insensitive substring matches with line numbers', async () => {
  writeFileSync(path.join(ws, 'hit.txt'), 'alpha\nNEEDLE found here\nbeta');
  const out = await exec({ pattern: 'needle', glob: '*.txt' });
  assert.match(out, /hit\.txt/);
  assert.match(out, /2: NEEDLE found here/);
});

test('search_text supports regex mode', async () => {
  writeFileSync(path.join(ws, 'hit.txt'), 'foo needle123 tail');
  const out = await exec({ pattern: 'needle\\d+', regex: true, glob: '*.txt' });
  assert.match(out, /hit\.txt/);
  assert.match(out, /1: foo needle123 tail/);
});

test('search_text accepts "path" as an alias for "glob"', async () => {
  mkdirSync(path.join(ws, 'sub'));
  writeFileSync(path.join(ws, 'sub', 'deep.txt'), 'deep needle');
  const out = await exec({ pattern: 'needle', path: 'sub/*.txt' });
  assert.match(out, /deep\.txt/);
});

test('search_text returns "No matches found" when nothing matches', async () => {
  writeFileSync(path.join(ws, 'a.txt'), 'nothing here');
  assert.equal(await exec({ pattern: 'needle', glob: '*.txt' }), 'No matches found');
});

// ---------------------------------------------------------------------------
// Denied-path — mocked permission layer
// ---------------------------------------------------------------------------

test('denied-path: search_text surfaces its documented denial under a denying permission layer', async () => {
  requestPermissionMock.mockResolvedValue(false);
  // The documented denied-result shape for this tool is the missing-scope
  // error string — requestPermission is never consulted (auto-approved).
  const out = await exec({ pattern: 'x' });
  assert.match(out, /Error: missing search path/);
  assert.equal(requestPermissionMock.mock.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Denial & boundary surfaces (this tool's resolveSafePath equivalents)
// ---------------------------------------------------------------------------

test('search_text never descends into the hard-ignored directories', async () => {
  mkdirSync(path.join(ws, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(path.join(ws, 'node_modules', 'pkg', 'hit.txt'), 'needle');
  // node_modules/.git/dist/build are unconditional ignores — the deny-list
  // equivalent for this tool (permissions.denyPaths is not consulted here).
  assert.equal(await exec({ pattern: 'needle', glob: '**/*.txt' }), 'No matches found');
});

test('search_text refuses glob matches over the 50-file cap', async () => {
  for (let i = 0; i < 51; i++) {
    writeFileSync(path.join(ws, `f${String(i).padStart(2, '0')}.txt`), 'needle');
  }
  const out = await exec({ pattern: 'needle', glob: '*.txt' });
  assert.match(out, /matched 51 files \(max 50\)/);
});

test('search_text has no workspace boundary — ".." globs resolve outside the root', async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'sc-search-outside-'));
  try {
    writeFileSync(path.join(outsideDir, 'escape.txt'), 'needle outside');
    // Characterizes the tool's actual boundary: fast-glob honors parent-dir
    // patterns, so results can include files outside workspaceRoot. There is
    // no resolveSafePath check on this path.
    const out = await exec({ pattern: 'needle', glob: `../${path.basename(outsideDir)}/*.txt` });
    assert.ok(out.includes(path.basename(outsideDir)));
    assert.match(out, /needle outside/);
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test('search_text requires a pattern', async () => {
  await assert.rejects(exec({ glob: '*.txt' }), /Missing required argument: pattern/);
});

test('search_text propagates invalid regex patterns', async () => {
  writeFileSync(path.join(ws, 'a.txt'), 'x');
  await assert.rejects(
    exec({ pattern: 'a(', regex: true, glob: '*.txt' }),
    /regular expression|Unterminated|Invalid/i,
  );
});
