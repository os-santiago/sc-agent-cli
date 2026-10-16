// Unit coverage for the repo_probe tool (#543). The probe pipeline
// (probeRepo + both formatters) is mocked, so these tests pin the adapter
// contract: workspace-root defaulting, refresh/format flags, path sandboxing
// via resolveSafePath, and the [ERROR]-string (not thrown) failure shape.
//
// repo_probe is an auto-approved read-only tool — it has no in-tool
// permission gate, so there is no denied path to exercise here (the agent's
// permission matrix covers read-only tools; see permissions-matrix.test.ts).

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { ToolContext } from './tool.js';
import type { RepoProfile } from '../core/repo-probe/types.js';

const mocks = vi.hoisted(() => ({
  probeRepo: vi.fn(),
  formatRepoProfileForPrompt: vi.fn(),
  formatRepoProfileJSON: vi.fn(),
}));

vi.mock('../core/repo-probe/index.js', () => mocks);

import { repoProbeTool } from './repo-probe-tool.js';

const WS = process.cwd();
const WS_REAL = realpathSync(WS);

const PROFILE: RepoProfile = {
  version: '1.1.0',
  timestamp: 0,
  root: WS_REAL,
  ecosystems: ['node'],
  confidence: 'high',
  toolchains: [{ name: 'node', version: '20.x' }],
  packageManagers: [{ name: 'npm', lockfile: 'package-lock.json' }],
  frameworks: [{ name: 'vitest', category: 'test' }],
  commands: { test: 'npm test' },
  ci: { providers: [], workflows: [], minedVerifyCommands: [] },
  devcontainer: false,
  manifests: ['package.json'],
};

function makeCtx(configOverrides: Partial<ToolContext['config']> = {}): ToolContext {
  return {
    workspaceRoot: WS,
    config: {
      model: { provider: 'openai-compatible', baseUrl: 'http://provider.test/v1', model: 'test-model' },
      ...configOverrides,
    },
  };
}

const exec = (args: Record<string, unknown>, ctx: ToolContext = makeCtx()) =>
  repoProbeTool.execute(args, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.probeRepo.mockResolvedValue(PROFILE);
  mocks.formatRepoProfileJSON.mockReturnValue('JSON_PROFILE');
  mocks.formatRepoProfileForPrompt.mockReturnValue('SUMMARY_MD');
});

describe('repo_probe — happy path', () => {
  test('defaults probe the real workspace root and return the JSON profile', async () => {
    const out = await exec({});
    assert.equal(out, 'JSON_PROFILE');
    assert.equal(mocks.probeRepo.mock.calls.length, 1);
    assert.equal(mocks.probeRepo.mock.calls[0][0], WS_REAL);
    assert.deepEqual(mocks.probeRepo.mock.calls[0][1], { forceRefresh: false, useCache: true });
    assert.deepEqual(mocks.formatRepoProfileJSON.mock.calls[0], [PROFILE]);
    assert.equal(mocks.formatRepoProfileForPrompt.mock.calls.length, 0);
  });

  test('format "summary" returns the prompt-format rendering', async () => {
    const out = await exec({ format: 'summary' });
    assert.equal(out, 'SUMMARY_MD');
    assert.equal(mocks.formatRepoProfileForPrompt.mock.calls.length, 1);
    assert.deepEqual(mocks.formatRepoProfileForPrompt.mock.calls[0], [PROFILE]);
    assert.equal(mocks.formatRepoProfileJSON.mock.calls.length, 0);
  });

  test('refresh bypasses the cache', async () => {
    await exec({ refresh: true });
    assert.deepEqual(mocks.probeRepo.mock.calls[0][1], { forceRefresh: true, useCache: false });
  });

  test('a relative path resolves inside the workspace', async () => {
    // A nonexistent subdir keeps realpathSync out of the expected value —
    // resolveSafePath falls back to the lexically resolved path.
    await exec({ path: 'sub/dir' });
    assert.equal(mocks.probeRepo.mock.calls[0][0], path.resolve(WS_REAL, 'sub/dir'));
  });

  test('the probed profile object is handed to the formatter verbatim', async () => {
    const other = { ...PROFILE, ecosystems: ['rust'], confidence: 'low' as const };
    mocks.probeRepo.mockResolvedValue(other);
    await exec({});
    assert.equal(mocks.formatRepoProfileJSON.mock.calls[0][0], other);
  });
});

describe('repo_probe — argument and error contract', () => {
  test('a path escaping the workspace is rejected before any probing', async () => {
    await assert.rejects(exec({ path: '../outside' }), /Access denied/);
    assert.equal(mocks.probeRepo.mock.calls.length, 0);
  });

  test('denyPaths in config are enforced before probing', async () => {
    const ctx = makeCtx({ permissions: { denyPaths: ['blocked/**'] } });
    await assert.rejects(exec({ path: 'blocked/thing' }, ctx), /deny pattern/);
    assert.equal(mocks.probeRepo.mock.calls.length, 0);
  });

  test('probe failures return an [ERROR] string instead of throwing', async () => {
    mocks.probeRepo.mockRejectedValue(new Error('disk gone'));
    const out = await exec({});
    assert.equal(out, '[ERROR] Failed to probe repository: disk gone');
  });

  test('formatter failures are reported the same way', async () => {
    mocks.formatRepoProfileJSON.mockImplementation(() => {
      throw new Error('render broke');
    });
    const out = await exec({});
    assert.equal(out, '[ERROR] Failed to probe repository: render broke');
  });

  test('a non-string or blank path falls back to the workspace root', async () => {
    await exec({ path: 42 });
    assert.equal(mocks.probeRepo.mock.calls[0][0], WS_REAL);
    await exec({ path: '   ' });
    assert.equal(mocks.probeRepo.mock.calls[1][0], WS_REAL);
  });

  test('an unrecognized format falls back to JSON', async () => {
    const out = await exec({ format: 'xml' });
    assert.equal(out, 'JSON_PROFILE');
    assert.equal(mocks.formatRepoProfileJSON.mock.calls.length, 1);
  });
});
