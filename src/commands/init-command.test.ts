import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject } from './init-command.js';

test('initProject preserves an existing AGENTS.md file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sc-agent-init-'));
  const agentsPath = join(tempDir, 'AGENTS.md');
  const existingContent = '# Existing instructions\n';
  writeFileSync(agentsPath, existingContent, 'utf-8');

  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    output.push(args.join(' '));
  };

  try {
    await initProject(tempDir);
    assert.equal(readFileSync(agentsPath, 'utf-8'), existingContent);
    assert.match(output.join('\n'), /already exists/i);
    assert.match(output.join('\n'), /unchanged/i);
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
