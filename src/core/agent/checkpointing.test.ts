import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maybeAutoSaveCheckpoint, CHECKPOINT_INTERVAL } from './checkpointing.js';
import type { Message } from '../types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-autockpt-'));
  vi.stubEnv('SC_CHECKPOINT_DIR', dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const messages: Message[] = [{ role: 'user', content: 'hi' }];

function baseOpts(overrides = {}) {
  return {
    sessionId: 'sess-1',
    lastCheckpointIteration: 0,
    iterations: 0,
    workspaceRoot: '/ws',
    messages,
    toolRunCount: 0,
    ...overrides,
  };
}

test('maybeAutoSaveCheckpoint skips until the interval elapses', async () => {
  const next = await maybeAutoSaveCheckpoint(baseOpts({ iterations: CHECKPOINT_INTERVAL - 1 }));
  assert.equal(next, 0);
  assert.equal(existsSync(join(dir, 'sess-1.json')), false);
});

test('maybeAutoSaveCheckpoint writes at the interval and advances the marker', async () => {
  const next = await maybeAutoSaveCheckpoint(baseOpts({ iterations: CHECKPOINT_INTERVAL }));
  assert.equal(next, CHECKPOINT_INTERVAL);
  assert.equal(existsSync(join(dir, 'sess-1.json')), true);
});

test('maybeAutoSaveCheckpoint measures cadence from the last save', async () => {
  const next = await maybeAutoSaveCheckpoint(baseOpts({ lastCheckpointIteration: 10, iterations: 10 + CHECKPOINT_INTERVAL - 1 }));
  assert.equal(next, 10);
  const after = await maybeAutoSaveCheckpoint(baseOpts({ lastCheckpointIteration: 10, iterations: 10 + CHECKPOINT_INTERVAL }));
  assert.equal(after, 10 + CHECKPOINT_INTERVAL);
});

test('maybeAutoSaveCheckpoint is a no-op without a session id', async () => {
  const next = await maybeAutoSaveCheckpoint(baseOpts({ sessionId: '', iterations: CHECKPOINT_INTERVAL }));
  assert.equal(next, 0);
});
