import test from 'node:test';
import assert from 'node:assert/strict';
import { runShellTool } from './run-shell.js';
import type { ToolContext } from './tool.js';

const toolContext: ToolContext = {
  workspaceRoot: process.cwd(),
  autoApprove: true,
  config: {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    },
  },
};

test('run_shell rejects invalid timeout values before execution', async () => {
  await assert.rejects(
    () => runShellTool.execute({ command: 'echo hello', timeout: 0 }, toolContext),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid timeout/);
      return true;
    }
  );
});

test('run_shell reports timeout failures with a clear message', async () => {
  const command = `"${process.execPath}" -e "setTimeout(() => {}, 200)"`;

  await assert.rejects(
    () => runShellTool.execute({ command, timeout: 50 }, toolContext),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Command timed out after 50ms');
      return true;
    }
  );
});
