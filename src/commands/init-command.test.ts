import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from './init-command.js';

test('initProject preserves an existing AGENTS.md file', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const existingContent = '# Existing instructions\n';
  await writeFile(agentsPath, existingContent, 'utf-8');

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };

  try {
    await initProject(cwd);
  } finally {
    console.log = originalLog;
  }

  const finalContent = await readFile(agentsPath, 'utf-8');
  assert.equal(finalContent, existingContent);
  assert.ok(logs.some((line) => line.includes('AGENTS.md already exists')));
});
