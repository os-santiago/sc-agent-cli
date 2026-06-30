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

  const output = await captureLogs(() => initProject(projectRoot));

  assert.match(output, /AGENTS\.md already exists/);
  assert.match(output, /sc init --force/);
  assert.equal(await readFile(agentsPath, 'utf-8'), originalContent);
});

test('initProject overwrites an existing AGENTS.md when force is enabled', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  const originalContent = '# Existing instructions\n';

  await writeFile(agentsPath, originalContent, 'utf-8');

  const output = await captureLogs(() => initProject(projectRoot, true));
  const updatedContent = await readFile(agentsPath, 'utf-8');

  assert.match(output, /✓ Overwrote/);
  assert.notEqual(updatedContent, originalContent);
  assert.match(updatedContent, /This file provides context to the SC-Agent/);
});

async function captureLogs(run: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
  }

  return logs.join('\n');
}
