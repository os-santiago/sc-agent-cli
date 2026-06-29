import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ProjectConfig } from '../core/types.js';
import { runShellTool } from './run-shell.js';

const testConfig: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
};

test('run_shell reports command timeouts clearly', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-run-shell-timeout-'));

  try {
    await assert.rejects(
      runShellTool.execute(
        {
          command: 'node -e "setTimeout(() => {}, 200)"',
          timeout: 50,
        },
        {
          workspaceRoot,
          config: testConfig,
          autoApprove: true,
        }
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Command timed out after 50ms/);
        assert.doesNotMatch(error.message, /code null/);
        return true;
      }
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
