import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleClear, handleUndo, handleRollback, persistSessionHistory } from './history.js';
import type { SessionContext } from './types.js';
import type { Agent } from '../../core/agent.js';
import type { Message } from '../../core/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-sesshist-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  const traces: Message[][] = [];
  return {
    options: {
      workspaceRoot: dir,
      config: { model: { provider: 'openai-compatible', baseUrl: 'http://x', model: 'm' } },
    },
    sessionId: 'sess-test',
    historyPaths: { conv: join(dir, 'conv.json'), input: join(dir, 'input.json') },
    saveSessionTrace: (msgs) => { traces.push(msgs); },
    historyCheckpoints: [],
    agent: {} as Agent,
    history: [{ role: 'user', content: 'hello' }],
    inputHistory: ['hello'],
    currentConfig: { model: { provider: 'openai-compatible', baseUrl: 'http://x', model: 'm' } },
    currentPermissionMode: 'ask_once',
    hudEnabled: false,
    hudFields: [],
    ...overrides,
  };
}

test('handleClear only consumes the /clear command', async () => {
  const ctx = makeCtx();
  assert.equal(await handleClear(ctx, 'hello'), false);
  assert.equal(await handleClear(ctx, '/clear'), true);
  assert.deepEqual(ctx.history, []);
});

test('handleUndo restores the most recent checkpoint', async () => {
  const previous: Message[] = [{ role: 'user', content: 'earlier' }];
  const ctx = makeCtx({
    history: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
    historyCheckpoints: [previous],
  });
  assert.equal(await handleUndo(ctx, '/undo'), true);
  assert.equal(ctx.history, previous);
  assert.equal(ctx.historyCheckpoints.length, 0);
});

test('handleUndo reports nothing to undo when the stack is empty', async () => {
  const ctx = makeCtx();
  assert.equal(await handleUndo(ctx, '/undo'), true);
  assert.equal(ctx.history.length, 1);
});

test('handleRollback slices history to the given index and saves a checkpoint', async () => {
  const ctx = makeCtx({
    history: [
      { role: 'user', content: 'm0' },
      { role: 'assistant', content: 'm1' },
      { role: 'user', content: 'm2' },
    ],
  });
  assert.equal(await handleRollback(ctx, '/rollback 1'), true);
  assert.deepEqual(ctx.history.map(m => m.content), ['m0']);
  // A restore checkpoint of the pre-rollback history was pushed
  assert.equal(ctx.historyCheckpoints.length, 1);
  assert.equal(ctx.historyCheckpoints[0].length, 3);
});

test('handleRollback rejects out-of-range and missing indices', async () => {
  const ctx = makeCtx({
    history: [{ role: 'user', content: 'm0' }],
  });
  assert.equal(await handleRollback(ctx, '/rollback'), true);
  assert.equal(ctx.history.length, 1);
  assert.equal(await handleRollback(ctx, '/rollback 99'), true);
  assert.equal(ctx.history.length, 1);
  assert.equal(ctx.historyCheckpoints.length, 0);
});

test('persistSessionHistory writes redacted conv + input files under historyPaths', () => {
  const ctx = makeCtx({
    history: [{ role: 'user', content: 'hi', timestamp: 't' }],
    inputHistory: ['hi'],
  });
  persistSessionHistory(ctx, 'warn');
  assert.equal(existsSync(ctx.historyPaths.conv), true);
  assert.equal(existsSync(ctx.historyPaths.input), true);
  const conv = JSON.parse(readFileSync(ctx.historyPaths.conv, 'utf-8'));
  assert.equal(conv[0].content, 'hi');
});
