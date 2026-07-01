import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from './init-command.js';

test('initProject creates AGENTS.md when it does not exist', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(projectRoot, 'AGENTS.md');

  await initProject(projectRoot);

  const contents = await readFile(agentsPath, 'utf-8');
  assert.match(contents, /# Agent Instructions/);
});

test('initProject preserves an existing AGENTS.md and explains next step', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-existing-'));
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  const originalContents = '# Existing instructions\n';

  await writeFile(agentsPath, originalContents, 'utf-8');

  await assert.rejects(
    () => initProject(projectRoot),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /AGENTS\.md already exists/);
      assert.match(error.message, /Edit the existing file directly/);
      assert.match(error.message, new RegExp(escapeRegex(agentsPath)));
      return true;
    }
  );

  const contentsAfterFailure = await readFile(agentsPath, 'utf-8');
  assert.equal(contentsAfterFailure, originalContents);
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
