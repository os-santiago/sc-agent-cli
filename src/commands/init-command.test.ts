import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from './init-command.js';

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const originalLog = console.log;
  const messages: string[] = [];

  console.log = (...args: unknown[]) => {
    messages.push(args.map(String).join(' '));
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
  }

  return messages;
}

test('initProject preserves an existing AGENTS.md unless force is used', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(workspace, 'AGENTS.md');
  const originalContent = '# Existing instructions\n\nDo not replace me.\n';

  await writeFile(agentsPath, originalContent, 'utf-8');

  const logs = await captureLogs(() => initProject(workspace));

  assert.equal(await readFile(agentsPath, 'utf-8'), originalContent);
  assert.ok(logs.some((line) => line.includes('already exists')));
  assert.ok(logs.some((line) => line.includes('--force')));
});

test('initProject overwrites an existing AGENTS.md when force is enabled', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(workspace, 'AGENTS.md');

  await writeFile(agentsPath, '# Old instructions\n', 'utf-8');

  const logs = await captureLogs(() => initProject(workspace, true));
  const updatedContent = await readFile(agentsPath, 'utf-8');

  assert.match(updatedContent, /# Agent Instructions/);
  assert.ok(logs.some((line) => line.includes('Overwrote')));
});
