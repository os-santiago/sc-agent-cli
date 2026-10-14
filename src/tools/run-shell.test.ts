import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// `spawn` is wrapped, not replaced: happy-path tests run real child processes
// through the production code path, while denied-path tests assert the spawn
// boundary was never reached.
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn(mod.spawn) };
});

// `requestPermission` delegates to the real gate so denyCommands and the
// git-mutation refusals keep their production semantics; the user-denial path
// is forced per-test via mockResolvedValueOnce(false).
vi.mock('../utils/permissions.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/permissions.js')>();
  return { ...mod, requestPermission: vi.fn(mod.requestPermission) };
});

// Dead-man switch: no test below should ever reach an interactive prompt — if
// one does, the prompt denies instead of hanging the suite.
vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'no', approved: false }) }));

import { runShellTool } from './run-shell.js';
import { requestPermission } from '../utils/permissions.js';
import { detectSandboxBackendCached, SandboxRuntime } from '../utils/sandbox.js';
import type { SandboxSpawnPlan, SandboxViolation } from '../utils/sandbox.js';
import type { ToolContext } from './tool.js';
import type { ProjectConfig } from '../core/types.js';

const spawnMock = vi.mocked(spawn);
const requestPermissionMock = vi.mocked(requestPermission);

// spawn() argument tuples as run_shell issues them (overloads collapse to the
// last signature, hence the explicit tuple shape).
type SpawnCall = [
  file: string,
  argv: string[],
  opts: { shell?: boolean; cwd?: string; env?: NodeJS.ProcessEnv; stdio?: unknown },
];

const spawnCalls = () => spawnMock.mock.calls as unknown as SpawnCall[];

// Spawn `node -e` via its absolute path — the scrubbed child env keeps PATH,
// but tests shouldn't depend on a PATH lookup succeeding. The js argument is
// double-quoted, so snippets must use single-quoted JS strings only.
const nodeEval = (js: string) => `"${process.execPath}" -e "${js}"`;

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'm' },
    ...over,
  };
}

function makeCtx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    config: baseConfig(),
    autoApprove: true, // unattended mode — the interactive prompt is never exercised
    ...over,
  };
}

const exec = (args: Record<string, unknown>, ctx: ToolContext) =>
  runShellTool.execute(args, ctx);

interface SandboxStubOpts {
  enabled?: boolean;
  violations?: SandboxViolation[];
  prepareSpawn?: (command: string) => Promise<SandboxSpawnPlan>;
  collectStderrViolations?: (stderr: string) => SandboxViolation[];
}

// Minimal SandboxRuntime-shaped stub — the tool only touches `enabled`,
// `violations`, `prepareSpawn` and `collectStderrViolations`.
function sandboxStub(over: SandboxStubOpts = {}): SandboxRuntime {
  return {
    enabled: over.enabled ?? true,
    violations: over.violations ?? [],
    prepareSpawn:
      over.prepareSpawn ??
      (async () => {
        throw new Error('sandbox backend unavailable');
      }),
    collectStderrViolations: over.collectStderrViolations ?? (() => []),
  } as unknown as SandboxRuntime;
}

beforeEach(() => {
  spawnMock.mockClear();
  requestPermissionMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test('run_shell rejects a missing command before touching permissions or spawn', async () => {
  await assert.rejects(exec({}, makeCtx()), /Missing required argument: command/);
  assert.equal(requestPermissionMock.mock.calls.length, 0);
  assert.equal(spawnMock.mock.calls.length, 0);
});

test('run_shell rejects commands containing null bytes', async () => {
  await assert.rejects(exec({ command: 'echo \0 hi' }, makeCtx()), /null bytes/);
  assert.equal(requestPermissionMock.mock.calls.length, 0);
  assert.equal(spawnMock.mock.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Permission gate — denied result shapes, nothing ever spawns
// ---------------------------------------------------------------------------

test('run_shell throws the denied result and never spawns when permission is refused', async () => {
  requestPermissionMock.mockResolvedValueOnce(false);
  await assert.rejects(exec({ command: 'echo hi' }, makeCtx()), /Permission denied by user/);
  assert.equal(spawnMock.mock.calls.length, 0);
  // The tool asked the gate under the run_shell tool name with the raw args.
  assert.equal(requestPermissionMock.mock.calls[0][0].toolName, 'run_shell');
  assert.equal(requestPermissionMock.mock.calls[0][0].args.command, 'echo hi');
});

test('run_shell honors permissions.denyCommands as a hard deny — even under -y', async () => {
  const ctx = makeCtx({ config: baseConfig({ permissions: { denyCommands: ['rm -rf'] } }) });
  await assert.rejects(
    exec({ command: 'rm -rf /tmp/sc-should-never-run' }, ctx),
    /denied by permissions\.denyCommands rule "rm -rf"/,
  );
  assert.equal(spawnMock.mock.calls.length, 0);
});

test('run_shell refuses git-mutating commands in unattended mode', async () => {
  await assert.rejects(
    exec({ command: 'git commit -m x' }, makeCtx({ autoApprove: true })),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /git commit refused/);
      assert.match(err.message, /unattended mode/);
      return true;
    },
  );
  assert.equal(spawnMock.mock.calls.length, 0);
});

test('run_shell honors permissions.denyGitMutation without needing -y', async () => {
  const ctx = makeCtx({
    autoApprove: false,
    config: baseConfig({ permissions: { denyGitMutation: true } }),
  });
  await assert.rejects(exec({ command: 'git push origin main' }, ctx), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /git push denied/);
    assert.match(err.message, /managed externally/);
    return true;
  });
  assert.equal(spawnMock.mock.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Happy path — real spawn, captured output, surfaced exit code
// ---------------------------------------------------------------------------

test('run_shell spawns via the shell and resolves with stdout', async () => {
  const out = await exec({ command: 'echo run-shell-hello' }, makeCtx());
  assert.match(out, /run-shell-hello/);
  assert.equal(spawnCalls().length, 1);
  const [file, argv, opts] = spawnCalls()[0];
  assert.equal(file, 'echo run-shell-hello');
  assert.deepEqual(argv, []);
  assert.equal(opts.shell, true);
  assert.equal(opts.cwd, process.cwd());
});

test('run_shell annotates captured stderr in the resolved output', async () => {
  const out = await exec(
    { command: nodeEval("process.stdout.write('o');process.stderr.write('e')") },
    makeCtx(),
  );
  assert.equal(out, 'o\n[stderr]\ne');
});

test('run_shell rejects with the surfaced exit code on non-zero exit', async () => {
  await assert.rejects(exec({ command: nodeEval('process.exit(7)') }, makeCtx()), /exited with code 7/);
});

test('run_shell resolves "(no output)" for a silent success', async () => {
  assert.equal(await exec({ command: nodeEval('0') }, makeCtx()), '(no output)');
});

// ---------------------------------------------------------------------------
// Child environment scrub + output redaction (#471)
// ---------------------------------------------------------------------------

test('run_shell hands spawn a scrubbed env — credential-shaped vars stripped', async () => {
  vi.stubEnv('SC_TEST_API_KEY', 'sekrit-material-123');
  const out = await exec(
    {
      command: nodeEval(
        "process.stdout.write(process.env.SC_TEST_API_KEY === undefined ? 'stripped' : 'leaked')",
      ),
    },
    makeCtx(),
  );
  assert.equal(out, 'stripped');
  const [, , opts] = spawnCalls()[0];
  assert.equal(opts.env?.SC_TEST_API_KEY, undefined);
  assert.equal(opts.env?.PATH, process.env.PATH); // safe base vars pass through
});

test('run_shell redacts known secret values from captured output', async () => {
  vi.stubEnv('TEST_SECRET_KEY', 'supersecretvalue123');
  const out = await exec(
    { command: nodeEval("process.stdout.write('supersecretvalue123')") },
    makeCtx(),
  );
  assert.equal(out, '***');
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

test('run_shell kills the child and rejects with the timeout result', async () => {
  const started = Date.now();
  await assert.rejects(
    exec(
      { command: nodeEval('setTimeout(()=>{},60000)'), timeout: 150 },
      makeCtx(),
    ),
    /timed out after 150ms/,
  );
  // SIGTERM terminates the child promptly — we never wait out the 60s sleep.
  assert.ok(Date.now() - started < 10_000, 'timeout should resolve well before the child exits naturally');
});

// ---------------------------------------------------------------------------
// Output cap
// ---------------------------------------------------------------------------

test('run_shell kills the child and rejects when output exceeds the 10MB cap', async () => {
  await assert.rejects(
    exec({ command: nodeEval("process.stdout.write('x'.repeat(11 * 1024 * 1024))") }, makeCtx()),
    /Output exceeded 10 MB limit/,
  );
});

// ---------------------------------------------------------------------------
// Sandbox planning — fail-closed, passthrough, plan plumbing
// ---------------------------------------------------------------------------

test('run_shell fails closed when the sandbox cannot be prepared — never spawns', async () => {
  const ctx = makeCtx({ sandbox: sandboxStub() });
  await assert.rejects(exec({ command: 'echo hi' }, ctx), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /\[SANDBOX_VIOLATION\] \{"rule":"spawn","target":"sandbox-setup"\}/);
    assert.match(err.message, /Sandboxed execution unavailable: sandbox backend unavailable/);
    assert.match(err.message, /NOT executed/);
    return true;
  });
  assert.equal(spawnMock.mock.calls.length, 0);
});

test('run_shell ignores a disabled sandbox runtime (plain shell passthrough)', async () => {
  const out = await exec(
    { command: 'echo passthrough-ok' },
    makeCtx({ sandbox: sandboxStub({ enabled: false }) }),
  );
  assert.match(out, /passthrough-ok/);
  assert.equal(spawnCalls()[0][2].shell, true);
});

test('run_shell honors a non-shell spawn plan (file/argv/env) from prepareSpawn', async () => {
  const stub = sandboxStub({
    prepareSpawn: async (command) => ({
      file: process.execPath,
      argv: ['-e', `process.stdout.write(${JSON.stringify(command)})`],
      shell: false,
      env: { ...process.env },
      execMode: 'bwrap',
    }),
  });
  const out = await exec({ command: 'planned-spawn-works' }, makeCtx({ sandbox: stub }));
  assert.equal(out, 'planned-spawn-works');
  const [file, argv, opts] = spawnCalls()[0];
  assert.equal(file, process.execPath);
  assert.equal(argv[0], '-e');
  assert.equal(opts.shell, undefined); // the non-shell spawn branch
});

// The extra stdio fd mirrors the seccomp-blob plumbing — POSIX-only in
// production (bwrap/x86_64), so keep the assertion off Windows.
test.skipIf(process.platform === 'win32')(
  'run_shell streams the seccomp blob into the extra pipe fd',
  async () => {
    const stub = sandboxStub({
      prepareSpawn: async () => ({
        file: process.execPath,
        argv: ['-e', "process.stdout.write(require('node:fs').readFileSync(3, 'utf8'))"],
        shell: false,
        env: { ...process.env },
        seccompFd: 3,
        seccompBlob: Buffer.from('cbpf-payload'),
        execMode: 'bwrap',
      }),
    });
    const out = await exec({ command: 'irrelevant' }, makeCtx({ sandbox: stub }));
    assert.equal(out, 'cbpf-payload');
    assert.deepEqual(spawnCalls()[0][2].stdio, ['ignore', 'pipe', 'pipe', 'pipe']);
  },
);

test('run_shell appends observed sandbox violations to a successful result', async () => {
  const recorded: SandboxViolation[] = [];
  const stub = sandboxStub({
    violations: recorded,
    prepareSpawn: async (command) => {
      // e.g. an egress-proxy denial observed while the command runs.
      recorded.push({ rule: 'egress', target: 'evil.com:443' });
      return { file: command, argv: [], shell: true, env: { ...process.env }, execMode: 'proxy' };
    },
  });
  const out = await exec({ command: 'echo boundary-ok' }, makeCtx({ sandbox: stub }));
  assert.match(out, /boundary-ok/);
  assert.match(out, /\[SANDBOX\] violation\(s\) observed/);
  assert.match(out, /\[SANDBOX_VIOLATION\] \{"rule":"egress","target":"evil\.com:443"\}/);
});

// ---------------------------------------------------------------------------
// Real bwrap boundary — gated behind host capability detection. When the host
// lacks a working bubblewrap the whole suite reports skipped, so these
// assertions never run in the default `npm test` on such machines.
// ---------------------------------------------------------------------------

const hasBwrap = () => detectSandboxBackendCached().mode === 'bwrap';

describe.skipIf(!hasBwrap())('run_shell inside a real bwrap sandbox', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  function sandboxedCtx() {
    const ws = mkdtempSync(path.join(tmpdir(), 'sc-run-shell-'));
    tmpDirs.push(ws);
    const rt = new SandboxRuntime({
      config: baseConfig({ sandbox: { enabled: true } }),
      workspaceRoot: ws,
    });
    // The runtime binds the realpath'd workspace — resolve it the same way so
    // the path embedded in the command string matches the bind (symlinked
    // tmpdirs would otherwise write into the /tmp overlay instead).
    return { ctx: makeCtx({ workspaceRoot: ws, sandbox: rt }), rt, ws: realpathSync(ws) };
  }

  test('executes the command through bwrap and returns stdout', async () => {
    const { ctx, rt, ws } = sandboxedCtx();
    try {
      const probe = path.join(ws, 'probe.txt');
      const out = await exec({ command: `echo bwrap-boundary-ok && echo wrote > "${probe}"` }, ctx);
      assert.match(out, /bwrap-boundary-ok/);
      // The workspace is the writable bind inside the sandbox.
      assert.ok(existsSync(probe));
      assert.equal(rt.backend.mode, 'bwrap');
      assert.equal(spawnCalls()[0][0], rt.backend.bwrapPath);
    } finally {
      rt.dispose();
    }
  });

  test('a filesystem denial surfaces [SANDBOX_VIOLATION] markers in the error', async () => {
    const { ctx, rt } = sandboxedCtx();
    try {
      await assert.rejects(
        exec({ command: 'touch /etc/sc-agent-probe-marker' }, ctx),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /Command exited with code/);
          assert.match(err.message, /\[SANDBOX_VIOLATION\] \{"rule":"fs"/);
          return true;
        },
      );
      assert.ok(rt.violations.length >= 1);
    } finally {
      rt.dispose();
    }
  });
});
