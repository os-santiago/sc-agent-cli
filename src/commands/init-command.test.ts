import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initProject } from './init-command.js';

test('initProject creates AGENTS.md when missing', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));

  await initProject(workspace);

  const agentsPath = path.join(workspace, 'AGENTS.md');
  const content = await readFile(agentsPath, 'utf-8');
  assert.match(content, /# Agent Instructions/);
});

test('initProject preserves existing AGENTS.md when overwrite is denied', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(workspace, 'AGENTS.md');

  await writeFile(agentsPath, 'existing instructions', 'utf-8');

  await initProject(workspace, {
    confirmOverwrite: async () => false,
  });

  const content = await readFile(agentsPath, 'utf-8');
  assert.equal(content, 'existing instructions');
});

test('initProject overwrites existing AGENTS.md when force is enabled', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(workspace, 'AGENTS.md');

  await writeFile(agentsPath, 'existing instructions', 'utf-8');

  await initProject(workspace, { force: true });

  const content = await readFile(agentsPath, 'utf-8');
  assert.match(content, /# Agent Instructions/);
});
