import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from './init-command.js';

test('initProject creates AGENTS.md when missing', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const logs = captureConsole();

  try {
    await initProject(cwd);
  } finally {
    logs.restore();
  }

  const contents = await readFile(agentsPath, 'utf-8');
  assert.match(contents, /# Agent Instructions/);
  assert.ok(logs.lines.some((line) => line.includes('Created')));
});

test('initProject preserves existing AGENTS.md unless force is set', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const originalContents = '# Existing instructions\n';
  await writeFile(agentsPath, originalContents, 'utf-8');
  const logs = captureConsole();

  try {
    await initProject(cwd);
  } finally {
    logs.restore();
  }

  const contents = await readFile(agentsPath, 'utf-8');
  assert.equal(contents, originalContents);
  assert.ok(logs.lines.some((line) => line.includes('already exists')));
  assert.ok(logs.lines.some((line) => line.includes('sc init --force')));
});

test('initProject overwrites existing AGENTS.md when force is set', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = path.join(cwd, 'AGENTS.md');
  await writeFile(agentsPath, '# Existing instructions\n', 'utf-8');
  const logs = captureConsole();

  try {
    await initProject(cwd, true);
  } finally {
    logs.restore();
  }

  const contents = await readFile(agentsPath, 'utf-8');
  assert.match(contents, /# Agent Instructions/);
  assert.ok(logs.lines.some((line) => line.includes('Overwrote')));
});

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };

  return {
    lines,
    restore: () => {
      console.log = originalLog;
    },
  };
}
