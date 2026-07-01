import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from './init-command.js';

test('initProject preserves an existing AGENTS.md unless force is enabled', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  const originalContent = '# Existing instructions\n';

  await writeFile(agentsPath, originalContent, 'utf-8');

  await initProject(projectRoot);

  const finalContent = await readFile(agentsPath, 'utf-8');
  assert.equal(finalContent, originalContent);
});

test('initProject overwrites an existing AGENTS.md when force is enabled', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(projectRoot, 'AGENTS.md');

  await writeFile(agentsPath, '# Existing instructions\n', 'utf-8');

  await initProject(projectRoot, true);

  const finalContent = await readFile(agentsPath, 'utf-8');
  assert.match(finalContent, /# Agent Instructions/);
});
