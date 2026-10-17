// Unit coverage for the git tool's full exported operation matrix (#542).
//
// gitTool.execute() self-gates through requestPermission() before touching
// the repository, then shells out to the `git` binary via spawnSync. These
// tests run the tool against throwaway fixture repos under os.tmpdir()
// (never the project checkout) and instrument the two seams it crosses:
//
//   - node:child_process.spawnSync — wrapped in a delegating spy so real git
//     still runs, while denial tests can assert zero git invocations.
//   - ../utils/permissions.js — requestPermission wrapped the same way: the
//     real gate (autoApprove, denyGitMutation, the interactive prompt) keeps
//     deciding, and a forced `false` produces the documented denied shape.
//
// prompts/chalk/box-drawing are mocked at the interactive boundary so the
// gate's "No (deny)" branch runs without a TTY. Fixture setup goes through
// execFileSync — an un-spied export — so helper calls never pollute the
// spawn counts asserted below.

import { test, describe, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

vi.mock('../utils/permissions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/permissions.js')>();
  return { ...actual, requestPermission: vi.fn(actual.requestPermission) };
});

// Interactive boundary — default answer approves both prompt shapes.
vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

import prompts from 'prompts';
import { requestPermission, clearSessionPermissions } from '../utils/permissions.js';
import { gitTool } from './git-tool.js';

// Loose handle over the spawnSync spy — the real signature is overloaded,
// so assertions only need the recorded argv list.
const spawnMock = spawnSync as unknown as {
  mock: { calls: Array<readonly unknown[]> };
  mockImplementationOnce: (fn: () => unknown) => void;
};

/** spawnSync calls that invoked the git binary since the last mock clear. */
function gitSpawnCalls(): Array<readonly unknown[]> {
  return spawnMock.mock.calls.filter((c) => c[0] === 'git');
}

/** Real git for fixture setup — execFileSync is not spied. */
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 30_000 }).trim();
}

const tempDirs: string[] = [];

/** A real repo in a fresh tmpdir: `main` branch, one commit, LF-stable. */
function initRepo(files: Record<string, string> = { 'file.txt': 'hello\n' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-git-tool-'));
  tempDirs.push(dir);
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.name', 'Test User'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  // Keep clean-tree/diff assertions deterministic on Windows runners.
  git(['config', 'core.autocrlf', 'false'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  git(['add', '.'], dir);
  git(['commit', '-m', 'initial commit'], dir);
  return dir;
}

/** A tmpdir that is not a git repository. */
function initBareDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-git-norepo-'));
  tempDirs.push(dir);
  return dir;
}

function makeCtx(
  workspaceRoot: string,
  config: {
    permissions?: ProjectConfig['permissions'];
    settings?: ProjectConfig['settings'];
  } = {},
  autoApprove = true,
): ToolContext {
  return {
    workspaceRoot,
    autoApprove,
    config: {
      model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
      permissions: config.permissions,
      settings: config.settings,
    },
  };
}

const exec = (args: Record<string, unknown>, ctx: ToolContext) => gitTool.execute(args, ctx);

let repo: string;

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
  repo = initRepo();
});

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Export surface — every enum member has coverage below.
// ─────────────────────────────────────────────────────────────────────────

describe('definition surface', () => {
  test('declares every operation covered by the matrix', () => {
    assert.equal(gitTool.definition.function.name, 'git');
    const params = gitTool.definition.function.parameters as {
      properties?: { operation?: { enum?: unknown } };
    };
    assert.deepEqual(params.properties?.operation?.enum, [
      'status', 'diff', 'log', 'show', 'branch', 'add', 'commit', 'format',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Read-only operations
// ─────────────────────────────────────────────────────────────────────────

describe('status', () => {
  test('reports a clean working tree on the current branch', async () => {
    const out = await exec({ operation: 'status' }, makeCtx(repo));
    assert.match(out, /On branch main/);
    assert.match(out, /Clean working tree/);
  });

  test('groups staged, modified and untracked entries', async () => {
    writeFileSync(join(repo, 'staged.txt'), 'staged\n');
    git(['add', 'staged.txt'], repo);
    writeFileSync(join(repo, 'file.txt'), 'hello\nmore\n'); // tracked, unstaged
    writeFileSync(join(repo, 'untracked.txt'), 'new\n');

    const out = await exec({ operation: 'status' }, makeCtx(repo));
    assert.match(out, /On branch main/);
    assert.match(out, /Staged \(1\)/);
    assert.match(out, /staged\.txt/);
    assert.match(out, /Modified \(1\)/);
    assert.match(out, /file\.txt/);
    assert.match(out, /Untracked \(1\)/);
    assert.match(out, /untracked\.txt/);
  });

  test('detached HEAD reports "On branch HEAD"', async () => {
    git(['checkout', '--detach', 'HEAD'], repo);
    const out = await exec({ operation: 'status' }, makeCtx(repo));
    assert.match(out, /On branch HEAD/);
  });
});

describe('diff', () => {
  test('returns "No changes to show." on a clean tree', async () => {
    assert.equal(await exec({ operation: 'diff' }, makeCtx(repo)), 'No changes to show.');
  });

  test('returns the unstaged diff for modified files', async () => {
    writeFileSync(join(repo, 'file.txt'), 'hello\nchanged line\n');
    const out = await exec({ operation: 'diff' }, makeCtx(repo));
    assert.match(out, /diff --git a\/file\.txt b\/file\.txt/);
    assert.match(out, /\+changed line/);
  });

  test('scopes the diff to the paths argument', async () => {
    const scoped = initRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
    writeFileSync(join(scoped, 'a.txt'), 'a\nchanged\n');
    writeFileSync(join(scoped, 'b.txt'), 'b\nchanged\n');
    const out = await exec({ operation: 'diff', paths: 'a.txt' }, makeCtx(scoped));
    assert.match(out, /a\.txt/);
    assert.ok(!out.includes('b.txt'), 'diff should be scoped to a.txt');
  });

  test('truncates diffs past the 8000-char cap', async () => {
    writeFileSync(join(repo, 'file.txt'), 'hello\n' + `${'x'.repeat(120)}\n`.repeat(120));
    const out = await exec({ operation: 'diff' }, makeCtx(repo));
    assert.ok(out.endsWith('[Diff truncated]'), `expected truncation marker, got tail: ${out.slice(-80)}`);
    assert.ok(out.length <= 8000 + '\n\n[Diff truncated]'.length);
  });
});

describe('log', () => {
  test('lists recent commits on the branch', async () => {
    const out = await exec({ operation: 'log' }, makeCtx(repo));
    assert.match(out, /Recent commits \(last 10\)/);
    assert.match(out, /initial commit/);
  });

  test('honors the limit argument', async () => {
    writeFileSync(join(repo, 'two.txt'), '2\n');
    git(['add', 'two.txt'], repo);
    git(['commit', '-m', 'second commit'], repo);
    writeFileSync(join(repo, 'three.txt'), '3\n');
    git(['add', 'three.txt'], repo);
    git(['commit', '-m', 'third commit'], repo);

    const out = await exec({ operation: 'log', limit: 2 }, makeCtx(repo));
    assert.match(out, /last 2/);
    assert.equal(out.trim().split('\n').length, 3); // header + 2 entries
    assert.match(out, /third commit/);
    assert.match(out, /second commit/);
    assert.ok(!out.includes('initial commit'));
  });

  test('filters history by the paths argument', async () => {
    const scoped = initRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
    writeFileSync(join(scoped, 'a.txt'), 'a\n2\n');
    git(['add', 'a.txt'], scoped);
    git(['commit', '-m', 'touch a'], scoped);
    writeFileSync(join(scoped, 'b.txt'), 'b\n2\n');
    git(['add', 'b.txt'], scoped);
    git(['commit', '-m', 'touch b'], scoped);

    const out = await exec({ operation: 'log', paths: 'a.txt' }, makeCtx(scoped));
    assert.match(out, /touch a/);
    assert.ok(!out.includes('touch b'), 'log should be scoped to a.txt');
  });

  test('returns "No commits found." for a path with no history', async () => {
    assert.equal(
      await exec({ operation: 'log', paths: 'never-committed.txt' }, makeCtx(repo)),
      'No commits found.',
    );
  });

  test('rejects on a repo with no commits (unborn HEAD)', async () => {
    const empty = initBareDir();
    git(['init', '-b', 'main'], empty);
    await assert.rejects(
      exec({ operation: 'log' }, makeCtx(empty)),
      /does not have any commits yet|ambiguous argument|bad default revision/,
    );
  });
});

describe('show', () => {
  test('shows HEAD with --stat by default', async () => {
    const out = await exec({ operation: 'show' }, makeCtx(repo));
    assert.match(out, /commit [0-9a-f]{7,40}/);
    assert.match(out, /initial commit/);
    assert.match(out, /file\.txt/);
    assert.match(out, /1 file changed/);
  });

  test('resolves the paths argument as the ref', async () => {
    writeFileSync(join(repo, 'second.txt'), '2\n');
    git(['add', 'second.txt'], repo);
    git(['commit', '-m', 'second commit'], repo);

    const out = await exec({ operation: 'show', paths: 'HEAD~1' }, makeCtx(repo));
    assert.match(out, /initial commit/);
    assert.ok(!out.includes('second commit'));
  });

  test('truncates output past the 8000-char cap', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 400; i++) {
      files[`fixture-file-number-${i.toString().padStart(3, '0')}.txt`] = 'x\n';
    }
    const big = initRepo(files);
    const out = await exec({ operation: 'show' }, makeCtx(big));
    assert.ok(out.endsWith('[Output truncated]'), `expected truncation marker, got tail: ${out.slice(-80)}`);
    assert.ok(out.length <= 8000 + '\n\n[Output truncated]'.length);
  });

  test('rejects on a repo with no commits (unborn HEAD)', async () => {
    const empty = initBareDir();
    git(['init', '-b', 'main'], empty);
    await assert.rejects(
      exec({ operation: 'show' }, makeCtx(empty)),
      /ambiguous argument|unknown revision|does not have any commits/,
    );
  });
});

describe('branch', () => {
  test('lists local branches with the current one marked', async () => {
    const out = await exec({ operation: 'branch' }, makeCtx(repo));
    assert.match(out, /Branches:/);
    assert.match(out, /\*\s*main/);
  });

  test('lists additional branches', async () => {
    git(['branch', 'feature-x'], repo);
    const out = await exec({ operation: 'branch' }, makeCtx(repo));
    assert.match(out, /feature-x/);
    assert.match(out, /main/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Mutating operations
// ─────────────────────────────────────────────────────────────────────────

describe('add', () => {
  test('stages the given path and shows the staged status', async () => {
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    const out = await exec({ operation: 'add', paths: 'new.txt' }, makeCtx(repo));
    assert.match(out, /✓ Staged: new\.txt/);
    assert.match(out, /A\s+new\.txt/);
    // Verified against the real index, not just the tool's output text.
    assert.match(git(['diff', '--cached', '--name-only'], repo), /new\.txt/);
  });

  test('stages everything when paths is omitted', async () => {
    writeFileSync(join(repo, 'file.txt'), 'hello\nchanged\n');
    writeFileSync(join(repo, 'extra.txt'), 'x\n');
    const out = await exec({ operation: 'add' }, makeCtx(repo));
    assert.match(out, /Staged: \./);
    const staged = git(['diff', '--cached', '--name-only'], repo);
    assert.match(staged, /file\.txt/);
    assert.match(staged, /extra\.txt/);
  });

  test('rejects a pathspec that matches nothing', async () => {
    await assert.rejects(
      exec({ operation: 'add', paths: 'no-such-file.txt' }, makeCtx(repo)),
      /did not match any files/,
    );
  });
});

describe('commit', () => {
  test('commits staged changes with the given message', async () => {
    writeFileSync(join(repo, 'file.txt'), 'hello\nchanged\n');
    git(['add', 'file.txt'], repo);
    const out = await exec({ operation: 'commit', message: 'feat: apply change' }, makeCtx(repo));
    assert.match(out, /✓ \[main [0-9a-f]+\] feat: apply change/);
    assert.equal(git(['log', '-1', '--format=%s'], repo), 'feat: apply change');
  });

  test('requires a message', async () => {
    await assert.rejects(
      exec({ operation: 'commit' }, makeCtx(repo)),
      /Commit message is required for commit operation/,
    );
  });

  test('rejects when there is nothing to commit', async () => {
    // `git commit` reports the clean tree on stdout and exits 1 — the tool
    // surfaces the exit-code error because stderr is empty.
    await assert.rejects(
      exec({ operation: 'commit', message: 'empty' }, makeCtx(repo)),
      /exited with code 1|nothing to commit/,
    );
  });

  test('commits formatter-modified files after git add -A', async () => {
    const ctx = makeCtx(repo, {
      settings: { formatters: ["node -e require('fs').appendFileSync('file.txt','fmt')"] },
    });
    const out = await exec({ operation: 'commit', message: 'chore: formatted commit' }, ctx);
    assert.match(out, /✓ Formatted \(/);
    assert.match(out, /and committed: \[main [0-9a-f]+\] chore: formatted commit/);
    assert.equal(git(['log', '-1', '--format=%s'], repo), 'chore: formatted commit');
    assert.match(readFileSync(join(repo, 'file.txt'), 'utf-8'), /fmt$/);
  });

  test('still commits plainly when formatters ran but changed nothing', async () => {
    writeFileSync(join(repo, 'file.txt'), 'hello\nchanged\n');
    git(['add', 'file.txt'], repo);
    const ctx = makeCtx(repo, { settings: { formatters: ['git status'] } });
    const out = await exec({ operation: 'commit', message: 'feat: plain commit' }, ctx);
    assert.match(out, /✓ \[main [0-9a-f]+\] feat: plain commit/);
    assert.ok(!out.includes('Formatted'));
  });

  test('aborts the commit when a configured formatter fails to run', async () => {
    const ctx = makeCtx(repo, { settings: { formatters: ['git frobnicate-not-a-command'] } });
    const out = await exec({ operation: 'commit', message: 'x' }, ctx);
    assert.match(out, /Some formatters failed to run/);
    assert.match(out, /Commit aborted/);
    assert.equal(git(['log', '-1', '--format=%s'], repo), 'initial commit');
  });
});

describe('format', () => {
  test('reports when no formatters are configured or detected', async () => {
    assert.equal(
      await exec({ operation: 'format' }, makeCtx(repo)),
      'No formatters configured or detected.',
    );
  });

  test('reports when every configured formatter left the tree unchanged', async () => {
    const ctx = makeCtx(repo, { settings: { formatters: ['git status'] } });
    assert.equal(await exec({ operation: 'format' }, ctx), '✓ All files already formatted.');
  });

  test('reports files changed by a formatter', async () => {
    const ctx = makeCtx(repo, {
      settings: { formatters: ["node -e require('fs').appendFileSync('file.txt','fmt')"] },
    });
    const out = await exec({ operation: 'format' }, ctx);
    assert.match(out, /✓ Formatted:/);
    assert.match(out, /appendFileSync/);
    assert.match(readFileSync(join(repo, 'file.txt'), 'utf-8'), /fmt$/);
  });

  test('surfaces formatter failures without the commit trailer', async () => {
    const ctx = makeCtx(repo, { settings: { formatters: ['git frobnicate-not-a-command'] } });
    const out = await exec({ operation: 'format' }, ctx);
    assert.match(out, /⚠ Some formatters failed:/);
    assert.match(out, /frobnicate-not-a-command/);
    assert.ok(!out.includes('Commit aborted'));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Permission gating — the tool must consult the gate before any git spawn.
// ─────────────────────────────────────────────────────────────────────────

describe('permission gating', () => {
  test('consults the gate with the git tool name and original args', async () => {
    await exec({ operation: 'status' }, makeCtx(repo));
    const calls = vi.mocked(requestPermission).mock.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].toolName, 'git');
    assert.deepEqual(calls[0][0].args, { operation: 'status' });
    assert.equal(calls[0][0].autoApprove, true);
  });

  test('a denied gate rejects with the documented shape without invoking git', async () => {
    vi.mocked(requestPermission).mockResolvedValueOnce(false);
    await assert.rejects(
      exec({ operation: 'commit', message: 'x' }, makeCtx(repo)),
      /Permission denied by user/,
    );
    assert.equal(vi.mocked(requestPermission).mock.calls.length, 1);
    assert.equal(gitSpawnCalls().length, 0, 'git must not run once the gate denies');
  });

  test('interactive "No" through the real gate denies without invoking git', async () => {
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      exec({ operation: 'add', paths: 'file.txt' }, makeCtx(repo, {}, false)),
      /Permission denied by user/,
    );
    assert.equal(vi.mocked(prompts).mock.calls.length, 1);
    assert.equal(gitSpawnCalls().length, 0);
  });

  test('interactive approval through the real gate proceeds to git', async () => {
    const out = await exec({ operation: 'status' }, makeCtx(repo, {}, false));
    assert.match(out, /On branch main/);
    assert.equal(vi.mocked(prompts).mock.calls.length, 1);
    assert.ok(gitSpawnCalls().length > 0);
  });

  test('denyGitMutation hard-blocks commit without invoking git', async () => {
    const ctx = makeCtx(repo, { permissions: { denyGitMutation: true } });
    await assert.rejects(
      exec({ operation: 'commit', message: 'x' }, ctx),
      /git commit denied.*managed externally/s,
    );
    assert.equal(gitSpawnCalls().length, 0);
    assert.equal(vi.mocked(prompts).mock.calls.length, 0, 'hard deny never prompts');
  });

  test('denyGitMutation hard-blocks add without invoking git', async () => {
    const ctx = makeCtx(repo, { permissions: { denyGitMutation: true } });
    await assert.rejects(
      exec({ operation: 'add', paths: 'file.txt' }, ctx),
      /git add denied.*managed externally/s,
    );
    assert.equal(gitSpawnCalls().length, 0);
    assert.equal(vi.mocked(prompts).mock.calls.length, 0, 'hard deny never prompts');
  });

  test('denyGitMutation leaves read-only operations working', async () => {
    const ctx = makeCtx(repo, { permissions: { denyGitMutation: true } });
    const out = await exec({ operation: 'status' }, ctx);
    assert.match(out, /On branch main/);
    assert.ok(gitSpawnCalls().length > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Error paths
// ─────────────────────────────────────────────────────────────────────────

describe('error paths', () => {
  test('rejects outside a git repository for every operation', async () => {
    const bare = initBareDir();
    for (const args of [
      { operation: 'status' },
      { operation: 'diff' },
      { operation: 'log' },
      { operation: 'show' },
      { operation: 'branch' },
      { operation: 'add', paths: '.' },
      { operation: 'commit', message: 'x' },
    ]) {
      // `git diff` outside a repo warns "Not a git repository" (capital N)
      // and exits 129 with a usage line; the others fail with the fatal
      // "not a git repository" form — cover both shapes.
      await assert.rejects(
        exec(args, makeCtx(bare)),
        /not a git repository|usage: git diff/i,
        JSON.stringify(args),
      );
    }
  });

  test('rejects an unknown operation after the git availability check', async () => {
    await assert.rejects(
      exec({ operation: 'frobnicate' }, makeCtx(repo)),
      /Unknown git operation: frobnicate/,
    );
    assert.equal(gitSpawnCalls().length, 1); // only the --version probe ran
  });

  test('fails cleanly when the git binary is unavailable', async () => {
    spawnMock.mockImplementationOnce(() => ({
      pid: 0,
      output: [null, '', ''],
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
      error: new Error('spawnSync git ENOENT'),
    }));
    await assert.rejects(
      exec({ operation: 'status' }, makeCtx(repo)),
      /Git is not installed or not in PATH/,
    );
    assert.equal(gitSpawnCalls().length, 1); // only the --version probe ran
  });

  test('a repo with no commits has a clean diff and no branches', async () => {
    const empty = initBareDir();
    git(['init', '-b', 'main'], empty);
    assert.equal(await exec({ operation: 'diff' }, makeCtx(empty)), 'No changes to show.');
    const out = await exec({ operation: 'branch' }, makeCtx(empty));
    assert.match(out, /Branches:/);
  });
});
