import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from './init-command.js';

test('initProject creates AGENTS.md when missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sc-init-test-'));

  try {
    await initProject(tempDir);

    const contents = await readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    assert.match(contents, /# Agent Instructions/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('initProject refuses to overwrite an existing AGENTS.md file', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sc-init-test-'));
  const agentsPath = path.join(tempDir, 'AGENTS.md');
  const existingContents = '# Existing instructions\n';

  try {
    await writeFile(agentsPath, existingContents, 'utf-8');

    await assert.rejects(
      () => initProject(tempDir),
      /AGENTS\.md already exists .* Move or remove it before running "sc init" again\./
    );

    const contents = await readFile(agentsPath, 'utf-8');
    assert.equal(contents, existingContents);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
