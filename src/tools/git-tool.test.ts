// git tool coverage (#545, parent #544): execute() — the permission gate,
// the `git --version` preflight, and the read-only operations (status, diff,
// log, show, branch) run against the real repo checkout; format/commit are
// exercised only through their non-mutating failure paths (a formatter
// command that exits non-zero aborts before `git add`/`git commit` is ever
// invoked — tests must never stage or commit in the developer's worktree).

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';

vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

import prompts from 'prompts';
import { gitTool } from './git-tool.js';
import { clearSessionPermissions } from '../utils/permissions.js';

function makeConfig(formatters?: string[]): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    permissions: { autoApprove: [] },
    ...(formatters ? { settings: { formatters } } : {}),
  };
}

// The repo checkout itself is the git workspace — `git status`/`log`/… work
// identically on every CI runner (a detached HEAD still resolves
// `rev-parse --abbrev-ref HEAD` → "HEAD").
function ctx(config: ProjectConfig = makeConfig()): ToolContext {
  return { workspaceRoot: process.cwd(), config, autoApprove: true };
}

// A formatter that exists everywhere CI runs but always exits non-zero, so
// the format/commit failure branches are deterministic on every platform.
const FAILING_FORMATTER = 'git definitely-not-a-real-subcommand-xyz';

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
});

describe('git tool', () => {
  test('denied permission rejects before git is invoked', async () => {
    const context: ToolContext = { workspaceRoot: process.cwd(), config: makeConfig() };
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      gitTool.execute({ operation: 'status' }, context),
      /Permission denied by user/,
    );
  });

  test('status reports the current branch', async () => {
    const out = await gitTool.execute({ operation: 'status' }, ctx());
    assert.match(out, /On branch/);
  });

  test('diff returns a string — the diff itself or the clean message', async () => {
    const out = await gitTool.execute({ operation: 'diff' }, ctx());
    assert.equal(typeof out, 'string');
    assert.ok(out === 'No changes to show.' || out.length > 0);
  });

  test('diff accepts a paths filter', async () => {
    const out = await gitTool.execute({ operation: 'diff', paths: 'package.json' }, ctx());
    assert.ok(out === 'No changes to show.' || out.length > 0);
  });

  test('log honors the limit and reports recent commits', async () => {
    const out = await gitTool.execute({ operation: 'log', limit: 3 }, ctx());
    assert.match(out, /Recent commits \(last 3\)/);
  });

  test('show defaults to HEAD and returns commit details', async () => {
    const out = await gitTool.execute({ operation: 'show' }, ctx());
    assert.ok(out.length > 0);
  });

  test('branch lists local and remote branches', async () => {
    const out = await gitTool.execute({ operation: 'branch' }, ctx());
    assert.match(out, /Branches:/);
  });

  test('format with no configured/detected formatters reports none', async () => {
    // An empty workspace has no manifests → detectFormatters finds nothing.
    const bare = mkdtempSync(join(tmpdir(), 'sc-gittool-bare-'));
    try {
      const out = await gitTool.execute(
        { operation: 'format' },
        { workspaceRoot: bare, config: makeConfig(), autoApprove: true },
      );
      assert.equal(out, 'No formatters configured or detected.');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test('format with a no-op formatter reports everything already formatted', async () => {
    // `git --version` exists on every runner, exits 0 and modifies nothing.
    const out = await gitTool.execute(
      { operation: 'format' },
      ctx(makeConfig(['git --version'])),
    );
    assert.match(out, /All files already formatted\./);
  });

  test('format reports formatter failures without staging anything', async () => {
    const out = await gitTool.execute(
      { operation: 'format' },
      ctx(makeConfig([FAILING_FORMATTER])),
    );
    assert.match(out, /Some formatters failed:/);
    assert.match(out, /definitely-not-a-real-subcommand-xyz/);
  });

  test('commit requires a message', async () => {
    await assert.rejects(
      gitTool.execute({ operation: 'commit' }, ctx()),
      /Commit message is required/,
    );
  });

  test('commit aborts when a configured formatter fails — never reaching `git commit`', async () => {
    const out = await gitTool.execute(
      { operation: 'commit', message: 'test commit' },
      ctx(makeConfig([FAILING_FORMATTER])),
    );
    assert.match(out, /Some formatters failed to run:/);
    assert.match(out, /Commit aborted\./);
  });

  test('add on a pathspec that matches nothing surfaces the git error', async () => {
    // `git add <absent path>` fails before touching the index — safe to run.
    await assert.rejects(
      gitTool.execute({ operation: 'add', paths: 'sc-test-definitely-absent-file' }, ctx()),
      // `fatal:` is emitted literally by git's die() in every locale — the
      // localized "did not match" wording is not reliable on non-English
      // machines.
      /fatal:|did not match|Git error|exited with code/i,
    );
  });

  test('an unknown operation is rejected', async () => {
    await assert.rejects(
      gitTool.execute({ operation: 'frobnicate' }, ctx()),
      /Unknown git operation: frobnicate/,
    );
  });
});
