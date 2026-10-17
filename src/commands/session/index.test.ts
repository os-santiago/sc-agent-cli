import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchSlashCommand } from './index.js';
import type { SessionContext } from './types.js';
import type { Agent } from '../../core/agent.js';
import type { Message } from '../../core/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-dispatch-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    options: {
      workspaceRoot: dir,
      config: { model: { provider: 'openai-compatible', baseUrl: 'http://x', model: 'm' } },
    },
    sessionId: 'sess-test',
    historyPaths: { conv: join(dir, 'conv.json'), input: join(dir, 'input.json') },
    saveSessionTrace: () => {},
    historyCheckpoints: [],
    agent: {} as Agent,
    history: [{ role: 'user', content: 'hello' } as Message],
    inputHistory: [],
    currentConfig: { model: { provider: 'openai-compatible', baseUrl: 'http://x', model: 'm' } },
    currentPermissionMode: 'ask_once',
    hudEnabled: false,
    hudFields: [],
    ...overrides,
  };
}

test('dispatchSlashCommand returns false for plain prompts so the agent runs', async () => {
  const ctx = makeCtx();
  assert.equal(await dispatchSlashCommand(ctx, 'explain this codebase'), false);
  assert.equal(await dispatchSlashCommand(ctx, 'fix the failing test'), false);
  // Untouched state
  assert.equal(ctx.history.length, 1);
});

test('dispatchSlashCommand routes /clear to the history handler', async () => {
  const ctx = makeCtx();
  assert.equal(await dispatchSlashCommand(ctx, '/clear'), true);
  assert.deepEqual(ctx.history, []);
});

test('dispatchSlashCommand routes /rollback args through the table', async () => {
  const ctx = makeCtx({
    history: [
      { role: 'user', content: 'm0' },
      { role: 'assistant', content: 'm1' },
      { role: 'user', content: 'm2' },
    ],
  });
  assert.equal(await dispatchSlashCommand(ctx, '/rollback 1'), true);
  assert.equal(ctx.history.length, 1);
});

test('dispatchSlashCommand treats bare /checkpoint as a handled command', async () => {
  const ctx = makeCtx();
  assert.equal(await dispatchSlashCommand(ctx, '/checkpoint'), true);
});

test('dispatchSlashCommand handles unknown-slash-lookalikes only when a handler matches', async () => {
  const ctx = makeCtx();
  // '/session' bare prints the command list — handled
  assert.equal(await dispatchSlashCommand(ctx, '/session'), true);
  // A prompt that merely contains a slash is not a command
  assert.equal(await dispatchSlashCommand(ctx, 'check src/index.ts'), false);
});
