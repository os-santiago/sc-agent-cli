// Sandbox integration tests (#544, parent #481): run_shell through a REAL
// bwrap boundary — fresh mount namespaces, read-only `/`, workspace bind —
// not the injected fake backend the unit suite uses.
//
// Double opt-in gate, evaluated at collection time:
//   SC_SANDBOX_TESTS=1  — explicit opt-in flag; CI sets it on the Linux leg
//                         only (`npm run test:sandbox` skips silently
//                         without it)
//   hasBwrap()          — Linux + working bubblewrap + usable unprivileged
//                         user namespaces; anywhere else the suite degrades
//                         to an all-skipped pass, so dev machines and CI
//                         never *require* bwrap or root.
//
// `!ENABLED` is checked first so the bwrap probe never spawns on hosts that
// did not opt in.

import { describe, test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../../src/core/types.js';
import type { ToolContext } from '../../src/tools/tool.js';
import { hasBwrap, SandboxRuntime } from '../../src/utils/sandbox.js';
import { runShellTool } from '../../src/tools/run-shell.js';

const ENABLED = process.env.SC_SANDBOX_TESTS === '1';

const tmpDirs: string[] = [];
const runtimes: SandboxRuntime[] = [];

afterEach(() => {
  while (runtimes.length) runtimes.pop()!.dispose();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeCtx(): { ctx: ToolContext; sandbox: SandboxRuntime } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sc-sbx-'));
  tmpDirs.push(workspaceRoot);
  const config: ProjectConfig = {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    sandbox: { enabled: true },
  };
  // No detectBackend override — the real host probe resolves the backend.
  const sandbox = new SandboxRuntime({ config, workspaceRoot });
  runtimes.push(sandbox);
  const ctx: ToolContext = { workspaceRoot, config, autoApprove: true, sandbox };
  return { ctx, sandbox };
}

describe.skipIf(!ENABLED || !hasBwrap())('run_shell inside a real bwrap sandbox', () => {
  test('the real host probe resolves the bwrap backend', () => {
    const { sandbox } = makeCtx();
    assert.equal(sandbox.backend.mode, 'bwrap');
  });

  test('a trivial command executes and returns stdout', async () => {
    const { ctx } = makeCtx();
    const out = await runShellTool.execute({ command: 'echo sc-sandbox-ok' }, ctx);
    assert.match(out, /sc-sandbox-ok/);
  });

  test('the workspace bind stays writable inside the sandbox', async () => {
    const { ctx } = makeCtx();
    await runShellTool.execute({ command: 'echo hi > inside.txt' }, ctx);
    assert.ok(existsSync(join(ctx.workspaceRoot, 'inside.txt')));
  });

  test('writes outside the workspace hit the read-only root and surface as fs violations', async () => {
    const { ctx, sandbox } = makeCtx();
    await assert.rejects(
      runShellTool.execute({ command: 'touch /sc-sandbox-must-fail' }, ctx),
      /exited with code|SANDBOX_VIOLATION/,
    );
    assert.ok(
      sandbox.violations.some((v) => v.rule === 'fs'),
      'expected a filesystem violation to be recorded by the runtime',
    );
  });
});
