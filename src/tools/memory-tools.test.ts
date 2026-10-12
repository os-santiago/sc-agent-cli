// memory_read / memory_write tool coverage (#545, parent #544): both
// execute() bodies — arg validation, the requestPermission gate on writes,
// the scoped summary/recall/search reads, and the content-free "move between
// tiers" path.
//
// The tools operate on the `persistentMemory` singleton rooted at
// ~/.sc-agent/memory — this suite re-exports a PersistentMemory bound to a
// tmp dir so no test can see or mutate a real user's store.

import { test, describe, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

const hoisted = vi.hoisted(() => ({ memDir: '' }));
vi.mock('../utils/memory.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/memory.js')>();
  hoisted.memDir = mkdtempSync(join(tmpdir(), 'sc-memtools-'));
  return { ...mod, persistentMemory: new mod.PersistentMemory(hoisted.memDir) };
});

import prompts from 'prompts';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';
import { memoryReadTool, memoryWriteTool } from './memory-tools.js';
import { clearSessionPermissions } from '../utils/permissions.js';

let wsDir: string;

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    permissions: { autoApprove: [] },
  };
}

function ctx(autoApprove = true): ToolContext {
  return { workspaceRoot: wsDir, config: makeConfig(), autoApprove };
}

beforeAll(() => {
  wsDir = mkdtempSync(join(tmpdir(), 'sc-memtools-ws-'));
});

afterAll(() => {
  rmSync(wsDir, { recursive: true, force: true });
  rmSync(hoisted.memDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
});

// Order matters inside this describe: the store is a singleton, so the
// read/move assertions build on the entries written by earlier tests.
describe('memory_write', () => {
  test('requires key (or its id alias)', async () => {
    await assert.rejects(memoryWriteTool.execute({ content: 'x' }, ctx()), /Missing required argument: key/);
  });

  test('rejects an invalid scope', async () => {
    await assert.rejects(
      memoryWriteTool.execute({ key: 'k', content: 'x', scope: 'bogus' }, ctx()),
      /Invalid scope: expected "workspace" or "global"/,
    );
  });

  test('a denied prompt rejects before writing', async () => {
    const context = ctx(false);
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      memoryWriteTool.execute({ key: 'nope', content: 'x' }, context),
      /Permission denied by user/,
    );
  });

  test('saves a workspace-scoped memory with tags', async () => {
    const out = await memoryWriteTool.execute(
      { key: 'greeting', content: 'hello world', tags: 'demo, test' },
      ctx(),
    );
    assert.match(out, /✓ Saved to workspace memory: "greeting" \[demo, test\]/);
  });

  test('a content-free write on a missing key explains content is required', async () => {
    await assert.rejects(
      memoryWriteTool.execute({ id: 'ghost-key', scope: 'global' }, ctx()),
      /Missing required argument: content/,
    );
  });
});

describe('memory_read', () => {
  test('recalls a stored key with its scope tag', async () => {
    const out = await memoryReadTool.execute({ key: 'greeting' }, ctx());
    assert.match(out, /\[memory:workspace\] \[greeting\]/);
    assert.match(out, /hello world/);
  });

  test('a missing key suggests memory_write', async () => {
    const out = await memoryReadTool.execute({ key: 'ghost-key' }, ctx());
    assert.match(out, /No memory found with key "ghost-key"/);
  });

  test('query search finds matching entries', async () => {
    const out = await memoryReadTool.execute({ query: 'hello' }, ctx());
    assert.match(out, /\[greeting\]/);
    assert.match(out, /hello world/);
  });

  test('a query with no hits reports it', async () => {
    const out = await memoryReadTool.execute({ query: 'zzz-no-hit' }, ctx());
    assert.match(out, /No memories found matching "zzz-no-hit"/);
  });

  test('no key and no query returns the summary', async () => {
    const out = await memoryReadTool.execute({}, ctx());
    assert.match(out, /Memories|No stored memories/);
    assert.match(out, /greeting/);
  });
});

describe('memory_write move path (#476)', () => {
  test('{id, scope} with no content re-files the existing entry to global', async () => {
    const out = await memoryWriteTool.execute({ id: 'greeting', scope: 'global' }, ctx());
    assert.match(out, /✓ Moved memory "greeting" → global scope/);

    const readBack = await memoryReadTool.execute({ key: 'greeting' }, ctx());
    assert.match(readBack, /\[memory:global\] \[greeting\]/);
  });

  test('an explicit empty content string also triggers the move path', async () => {
    const out = await memoryWriteTool.execute(
      { key: 'greeting', content: '', scope: 'workspace' },
      ctx(),
    );
    assert.match(out, /✓ Moved memory "greeting" → workspace scope/);
  });
});
