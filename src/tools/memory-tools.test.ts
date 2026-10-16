// Unit coverage for the persistent-memory tools (#543). The memory store and
// the permission layer are both mocked, so these tests pin the adapter
// contract: argument-validation order, scope/tag formatting, the move-only
// re-file path, and the guarantee that a permission denial never reaches the
// store.

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import type { ToolContext } from './tool.js';
import type { MemoryEntry } from '../utils/memory.js';

const mocks = vi.hoisted(() => ({
  requestPermission: vi.fn(),
  getSummary: vi.fn(),
  recallEntry: vi.fn(),
  search: vi.fn(),
  remember: vi.fn(),
  move: vi.fn(),
}));

vi.mock('../utils/permissions.js', () => ({ requestPermission: mocks.requestPermission }));
vi.mock('../utils/memory.js', () => ({
  persistentMemory: {
    getSummary: mocks.getSummary,
    recallEntry: mocks.recallEntry,
    search: mocks.search,
    remember: mocks.remember,
    move: mocks.move,
  },
  memoryScopeTag: (scope: string) => `[memory:${scope}]`,
}));

import { memoryReadTool, memoryWriteTool } from './memory-tools.js';

function makeCtx(): ToolContext {
  return {
    workspaceRoot: '/ws',
    config: {
      model: { provider: 'openai-compatible', baseUrl: 'http://provider.test/v1', model: 'test-model' },
    },
  };
}

function entry(over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { key: 'k', content: 'c', timestamp: 1, tags: [], scope: 'workspace', ...over };
}

function storeCalls(): number {
  return (
    mocks.getSummary.mock.calls.length +
    mocks.recallEntry.mock.calls.length +
    mocks.search.mock.calls.length +
    mocks.remember.mock.calls.length +
    mocks.move.mock.calls.length
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestPermission.mockResolvedValue(true);
});

describe('memory_read', () => {
  const exec = (args: Record<string, unknown>) => memoryReadTool.execute(args, makeCtx());

  test('returns the store summary when neither key nor query is given', async () => {
    mocks.getSummary.mockResolvedValue('SUMMARY-OUTPUT');
    const out = await exec({});
    assert.equal(out, 'SUMMARY-OUTPUT');
    assert.deepEqual(mocks.getSummary.mock.calls[0], ['/ws']);
  });

  test('recalls a single key with its scope provenance tag', async () => {
    mocks.recallEntry.mockResolvedValue(entry({ key: 'prefs', content: 'uses tabs', scope: 'global' }));
    const out = await exec({ key: 'prefs' });
    assert.equal(out, '[memory:global] [prefs]\nuses tabs');
    assert.deepEqual(mocks.recallEntry.mock.calls[0], ['prefs', '/ws']);
  });

  test('missing key returns the documented not-found guidance', async () => {
    mocks.recallEntry.mockResolvedValue(null);
    const out = await exec({ key: 'nope' });
    assert.equal(out, 'No memory found with key "nope". Use memory_write to save information about this topic.');
  });

  test('query returns tagged matches separated by --- and truncates long content', async () => {
    mocks.search.mockResolvedValue([
      entry({ key: 'long', content: 'x'.repeat(600) }),
      entry({ key: 'short', content: 'tiny', scope: 'global' }),
    ]);
    const out = await exec({ query: 'q' });
    const parts = out.split('\n\n---\n\n');
    assert.equal(parts.length, 2);
    assert.match(parts[0], /^\[memory:workspace\] \[long\]/);
    assert.ok(parts[0].includes('x'.repeat(500) + '...'));
    assert.ok(!parts[0].includes('x'.repeat(501)), 'content is capped at 500 chars');
    assert.match(parts[1], /^\[memory:global\] \[short\]\ntiny$/);
    assert.deepEqual(mocks.search.mock.calls[0], ['q', '/ws']);
  });

  test('query with no matches reports it', async () => {
    mocks.search.mockResolvedValue([]);
    const out = await exec({ query: 'nothing' });
    assert.equal(out, 'No memories found matching "nothing".');
  });

  test('key wins when both key and query are provided', async () => {
    mocks.recallEntry.mockResolvedValue(entry({ key: 'k', content: 'v' }));
    const out = await exec({ key: 'k', query: 'ignored' });
    assert.match(out, /\[k\]/);
    assert.equal(mocks.search.mock.calls.length, 0);
  });

  test('never consults the permission layer (auto-approved read path)', async () => {
    mocks.getSummary.mockResolvedValue('s');
    await exec({});
    mocks.recallEntry.mockResolvedValue(entry());
    await exec({ key: 'k' });
    assert.equal(mocks.requestPermission.mock.calls.length, 0);
  });
});

describe('memory_write', () => {
  const exec = (args: Record<string, unknown>) => memoryWriteTool.execute(args, makeCtx());

  test('saves a workspace memory by default and reports the scope', async () => {
    mocks.remember.mockResolvedValue(entry({ key: 'prefs', content: 'uses tabs' }));
    const out = await exec({ key: 'prefs', content: 'uses tabs' });
    assert.equal(out, '✓ Saved to workspace memory: "prefs"');
    assert.deepEqual(mocks.remember.mock.calls[0], [
      'prefs',
      'uses tabs',
      [],
      { scope: 'workspace', workspaceRoot: '/ws' },
    ]);
    // The write self-gates through the permission layer with the raw args.
    assert.equal(mocks.requestPermission.mock.calls.length, 1);
    const perm = mocks.requestPermission.mock.calls[0][0];
    assert.equal(perm.toolName, 'memory_write');
    assert.deepEqual(perm.args, { key: 'prefs', content: 'uses tabs' });
  });

  test('id is accepted as an alias for key', async () => {
    mocks.remember.mockResolvedValue(entry({ key: 'aliased' }));
    const out = await exec({ id: 'aliased', content: 'v' });
    assert.equal(out, '✓ Saved to workspace memory: "aliased"');
    assert.equal(mocks.remember.mock.calls[0][0], 'aliased');
  });

  test('scope "global" is forwarded to the store', async () => {
    mocks.remember.mockResolvedValue(entry({ key: 'g', scope: 'global' }));
    const out = await exec({ key: 'g', content: 'v', scope: 'global' });
    assert.equal(out, '✓ Saved to global memory: "g"');
    assert.equal(mocks.remember.mock.calls[0][3].scope, 'global');
  });

  test('comma-separated tags are parsed and echoed in the result', async () => {
    mocks.remember.mockResolvedValue(entry({ key: 't', tags: ['a', 'b'] }));
    const out = await exec({ key: 't', content: 'v', tags: ' a ,b ,, ' });
    assert.deepEqual(mocks.remember.mock.calls[0][2], ['a', 'b']);
    assert.equal(out, '✓ Saved to workspace memory: "t" [a, b]');
  });

  test('a write without content re-files an existing memory (move path)', async () => {
    mocks.recallEntry.mockResolvedValue(entry({ key: 'k' }));
    mocks.move.mockResolvedValue(entry({ key: 'k', scope: 'global' }));
    const out = await exec({ key: 'k', scope: 'global' });
    assert.equal(out, '✓ Moved memory "k" → global scope');
    assert.deepEqual(mocks.move.mock.calls[0], ['k', 'global', '/ws']);
    assert.equal(mocks.remember.mock.calls.length, 0);
  });

  test('empty-string content also takes the move path', async () => {
    mocks.recallEntry.mockResolvedValue(entry({ key: 'k' }));
    mocks.move.mockResolvedValue(entry({ key: 'k', scope: 'workspace' }));
    const out = await exec({ key: 'k', content: '', scope: 'workspace' });
    assert.equal(out, '✓ Moved memory "k" → workspace scope');
    assert.equal(mocks.remember.mock.calls.length, 0);
  });

  test('missing key and id rejects before the permission layer runs', async () => {
    await assert.rejects(exec({ content: 'v' }), /Missing required argument: key \(or id\)/);
    assert.equal(mocks.requestPermission.mock.calls.length, 0);
    assert.equal(storeCalls(), 0);
  });

  test('an invalid scope rejects before the permission layer runs', async () => {
    await assert.rejects(
      exec({ key: 'k', content: 'v', scope: 'bogus' }),
      /Invalid scope: expected "workspace" or "global"/,
    );
    assert.equal(mocks.requestPermission.mock.calls.length, 0);
    assert.equal(storeCalls(), 0);
  });

  test('a content-less write to an unknown key asks for content', async () => {
    mocks.recallEntry.mockResolvedValue(null);
    await assert.rejects(
      exec({ key: 'ghost' }),
      /Missing required argument: content \(required for new memories\)/,
    );
    assert.equal(mocks.move.mock.calls.length, 0);
    assert.equal(mocks.remember.mock.calls.length, 0);
  });

  test('denied permission rejects and the store is never invoked', async () => {
    mocks.requestPermission.mockResolvedValue(false);
    await assert.rejects(
      exec({ key: 'k', content: 'v' }),
      /Permission denied by user/,
    );
    assert.equal(mocks.requestPermission.mock.calls.length, 1);
    assert.equal(storeCalls(), 0);
  });

  test('non-string tags reject before the permission layer runs', async () => {
    await assert.rejects(exec({ key: 'k', content: 'v', tags: 123 }), TypeError);
    assert.equal(mocks.requestPermission.mock.calls.length, 0);
    assert.equal(storeCalls(), 0);
  });
});
