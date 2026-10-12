// repo_probe tool coverage (#545, parent #544): execute() — default vs.
// explicit path resolution through resolveSafePath, the refresh flag's cache
// contract ({forceRefresh, useCache}), json/summary output selection and the
// "[ERROR] Failed to probe repository" containment.
//
// probeRepo itself is mocked (it has its own suite under core/repo-probe/);
// the real formatRepoProfile{JSON,ForPrompt} run on a canned RepoProfile so
// the output is identical on every runner.

import { test, describe, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';
import type { RepoProfile } from '../core/repo-probe/index.js';

vi.mock('../core/repo-probe/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../core/repo-probe/index.js')>();
  return { ...mod, probeRepo: vi.fn() };
});

import { repoProbeTool } from './repo-probe-tool.js';
import { probeRepo } from '../core/repo-probe/index.js';

const PROFILE: RepoProfile = {
  version: '1.1.0',
  timestamp: 1700000000000,
  root: '/ws/demo',
  ecosystems: ['node'],
  confidence: 'high',
  toolchains: [{ name: 'node', version: '22.0.0' }],
  packageManagers: [{ name: 'npm', lockfile: 'package-lock.json' }],
  frameworks: [{ name: 'vitest', category: 'test' }],
  commands: { test: 'npm test', build: 'npm run build' },
  ci: { providers: [], workflows: [], minedVerifyCommands: [] },
  devcontainer: false,
  manifests: ['package.json'],
};

let dir: string;

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
  };
}

function ctx(): ToolContext {
  return { workspaceRoot: dir, config: makeConfig() };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-probetool-'));
  mkdirSync(join(dir, 'sub'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(probeRepo).mockResolvedValue(PROFILE);
});

describe('repo_probe', () => {
  test('defaults: workspace root, json output, cache allowed', async () => {
    const out = await repoProbeTool.execute({}, ctx());
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.ecosystems, ['node']);
    assert.equal(parsed.commands.test, 'npm test');

    const call = vi.mocked(probeRepo).mock.calls.at(-1)!;
    assert.equal(call[0], realpathSync(dir));
    assert.deepEqual(call[1], { forceRefresh: false, useCache: true });
  });

  test('format: "summary" returns the markdown profile', async () => {
    const out = await repoProbeTool.execute({ format: 'summary' }, ctx());
    assert.match(out, /## Repository Profile/);
    assert.match(out, /node/);
    assert.match(out, /npm test/);
  });

  test('path + refresh: resolves the subpath and bypasses the cache', async () => {
    await repoProbeTool.execute({ path: 'sub', refresh: true, format: 'json' }, ctx());
    const call = vi.mocked(probeRepo).mock.calls.at(-1)!;
    assert.equal(call[0], realpathSync(join(dir, 'sub')));
    assert.deepEqual(call[1], { forceRefresh: true, useCache: false });
  });

  test('a blank path falls back to the workspace root', async () => {
    await repoProbeTool.execute({ path: '   ' }, ctx());
    assert.equal(vi.mocked(probeRepo).mock.calls.at(-1)![0], realpathSync(dir));
  });

  test('paths outside the workspace are refused before probing', async () => {
    await assert.rejects(
      repoProbeTool.execute({ path: '../../../../' }, ctx()),
      /outside the workspace/,
    );
    assert.equal(vi.mocked(probeRepo).mock.calls.length, 0);
  });

  test('a probe failure is contained as an [ERROR] result', async () => {
    vi.mocked(probeRepo).mockRejectedValueOnce(new Error('boom'));
    const out = await repoProbeTool.execute({}, ctx());
    assert.match(out, /\[ERROR\] Failed to probe repository: boom/);
  });
});
