// run_shell tool coverage (#545, parent #544): execute() — arg validation,
// the permission gate, the scrubbed-child-env spawn (shell:true default and
// the sandbox-supplied shell:false plan), stderr collection, non-zero exit,
// timeout kill, spawn error, seccomp-fd blob write, violation reporting and
// the fail-closed prepareSpawn error path.
//
// Sandboxed paths are driven through a fake SandboxRuntime whose spawn plan
// targets process.execPath directly — deterministic on every OS, no bwrap
// or shell quoting required. Real child processes; no network.

import { test, describe, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';
import type { SandboxRuntime, SandboxSpawnPlan, SandboxViolation } from '../utils/sandbox.js';

vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

import prompts from 'prompts';
import { runShellTool } from './run-shell.js';
import { clearSessionPermissions } from '../utils/permissions.js';
import { buildChildEnv } from '../utils/env-scrub.js';

const NODE = process.execPath;

let dir: string;

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    permissions: { autoApprove: [] },
  };
}

function ctx(sandbox?: SandboxRuntime): ToolContext {
  return { workspaceRoot: dir, config: makeConfig(), autoApprove: true, ...(sandbox ? { sandbox } : {}) };
}

/**
 * A SandboxRuntime lookalike: prepareSpawn returns a direct node spawn plan
 * (shell:false → spec.file/spec.argv) or rejects to exercise the fail-closed
 * path; collectStderrViolations returns pre-seeded hits.
 */
function fakeSandbox(opts: {
  plan?: Partial<SandboxSpawnPlan>;
  prepareError?: Error;
  stderrViolations?: SandboxViolation[];
  runtimeViolations?: SandboxViolation[];
}): SandboxRuntime {
  const violations: SandboxViolation[] = [];
  const fake = {
    enabled: true,
    violations,
    async prepareSpawn(_command: string): Promise<SandboxSpawnPlan> {
      if (opts.prepareError) throw opts.prepareError;
      // run_shell marks violations.length BEFORE prepareSpawn — anything the
      // runtime records during/before spawn must land after the mark to be
      // reported, so seed them here rather than in the constructor.
      violations.push(...(opts.runtimeViolations ?? []));
      return {
        file: NODE,
        argv: [],
        shell: false,
        env: buildChildEnv(process.env),
        execMode: 'bwrap',
        ...(opts.plan ?? {}),
      };
    },
    collectStderrViolations(_stderr: string): SandboxViolation[] {
      return opts.stderrViolations ?? [];
    },
  };
  return fake as unknown as SandboxRuntime;
}

const nodePlan = (script: string, extra: Partial<SandboxSpawnPlan> = {}): Partial<SandboxSpawnPlan> => ({
  argv: ['-e', script],
  ...extra,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-runshell-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
});

describe('run_shell', () => {
  test('requires command', async () => {
    await assert.rejects(runShellTool.execute({}, ctx()), /Missing required argument: command/);
  });

  test('rejects commands containing null bytes', async () => {
    await assert.rejects(
      runShellTool.execute({ command: 'echo a\0b' }, ctx()),
      /null bytes/,
    );
  });

  test('a denied prompt rejects before spawning', async () => {
    const context: ToolContext = { workspaceRoot: dir, config: makeConfig() };
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      runShellTool.execute({ command: 'echo never' }, context),
      /Permission denied by user/,
    );
  });

  test('unsandboxed (shell:true) execution returns stdout', async () => {
    const out = await runShellTool.execute({ command: 'echo sc-runshell-ok' }, ctx());
    assert.match(out, /sc-runshell-ok/);
  });

  test('a sandbox plan spawns the command directly (shell:false) and returns output', async () => {
    const sandbox = fakeSandbox({ plan: nodePlan('console.log("sandboxed-ok")') });
    const out = await runShellTool.execute({ command: 'irrelevant' }, ctx(sandbox));
    assert.match(out, /sandboxed-ok/);
  });

  test('non-zero exit rejects with the exit code and captured output', async () => {
    const sandbox = fakeSandbox({ plan: nodePlan('console.log("partial");process.exit(3)') });
    await assert.rejects(
      runShellTool.execute({ command: 'x' }, ctx(sandbox)),
      /exited with code 3/,
    );
  });

  test('stderr is appended under a [stderr] marker', async () => {
    const sandbox = fakeSandbox({ plan: nodePlan('process.stderr.write("oops-line")') });
    const out = await runShellTool.execute({ command: 'x' }, ctx(sandbox));
    assert.match(out, /\[stderr\]/);
    assert.match(out, /oops-line/);
  });

  test('an over-time command is killed and reported as timed out', async () => {
    const sandbox = fakeSandbox({ plan: nodePlan('setTimeout(()=>{},9000)') });
    await assert.rejects(
      runShellTool.execute({ command: 'x', timeout: 150 }, ctx(sandbox)),
      /timed out after 150ms/,
    );
  });

  test('a spawn failure rejects with "Failed to execute command"', async () => {
    const sandbox = fakeSandbox({ plan: { file: 'sc-runshell-missing-binary', argv: [], shell: false } });
    await assert.rejects(
      runShellTool.execute({ command: 'x' }, ctx(sandbox)),
      /Failed to execute command/,
    );
  });

  test('a failing prepareSpawn fails closed with a SANDBOX_VIOLATION marker', async () => {
    const sandbox = fakeSandbox({ prepareError: new Error('egress proxy bind failed') });
    await assert.rejects(
      runShellTool.execute({ command: 'x' }, ctx(sandbox)),
      /\[SANDBOX_VIOLATION\].*sandbox-setup/s,
    );
    await assert.rejects(
      runShellTool.execute({ command: 'x' }, ctx(sandbox)),
      /The command was NOT executed/,
    );
  });

  test('stderr-detected violations are reported on the result', async () => {
    const sandbox = fakeSandbox({
      plan: nodePlan('process.stderr.write("network is unreachable")'),
      stderrViolations: [{ rule: 'egress', target: 'example.com' }],
      runtimeViolations: [{ rule: 'fs', target: '/etc/passwd' }],
    });
    const out = await runShellTool.execute({ command: 'x' }, ctx(sandbox));
    assert.match(out, /\[SANDBOX\] violation\(s\) observed/);
    assert.match(out, /\[SANDBOX_VIOLATION\] \{"rule":"egress","target":"example\.com"\}/);
    assert.match(out, /\[SANDBOX_VIOLATION\] \{"rule":"fs","target":"\/etc\/passwd"\}/);
  });

  test('a seccomp plan writes the cBPF blob to the extra pipe fd', async () => {
    const sandbox = fakeSandbox({
      plan: nodePlan('process.exit(0)', { seccompFd: 3, seccompBlob: Buffer.from('bpf') }),
    });
    const out = await runShellTool.execute({ command: 'x' }, ctx(sandbox));
    assert.equal(out, '(no output)');
  });
});
