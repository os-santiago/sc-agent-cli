import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadProjectContext } from './project-context.js';

test('loadProjectContext combines context files in priority order', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-project-context-'));

  try {
    await writeFile(path.join(workspaceRoot, 'SC-AGENT.md'), 'Second file', 'utf-8');
    await writeFile(path.join(workspaceRoot, 'CLAUDE.md'), 'Third file', 'utf-8');
    await writeFile(path.join(workspaceRoot, 'AGENTS.md'), 'First file', 'utf-8');

    const context = await loadProjectContext(workspaceRoot);

    assert.equal(
      context,
      '# AGENTS.md\nFirst file\n\n# SC-AGENT.md\nSecond file\n\n# CLAUDE.md\nThird file'
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadProjectContext returns null when no context files exist', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sc-project-context-empty-'));

  try {
    const context = await loadProjectContext(workspaceRoot);
    assert.equal(context, null);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
