import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from './init-command.js';

test('initProject does not overwrite an existing AGENTS.md without force', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(tempDir, 'AGENTS.md');

  try {
    await writeFile(agentsPath, 'existing instructions', 'utf-8');

    await initProject(tempDir);

    const content = await readFile(agentsPath, 'utf-8');
    assert.equal(content, 'existing instructions');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('initProject overwrites an existing AGENTS.md when force is enabled', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(tempDir, 'AGENTS.md');

  try {
    await writeFile(agentsPath, 'existing instructions', 'utf-8');

    await initProject(tempDir, { force: true });

    const content = await readFile(agentsPath, 'utf-8');
    assert.match(content, /# Agent Instructions/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
