import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), '..', '..');
const cliPath = path.join(repoRoot, 'dist', 'cli.js');

function runScInit(cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'init'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test('sc init creates AGENTS.md in the current directory', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sc-init-success-'));

  try {
    const result = await runScInit(tempDir);
    const agentsPath = path.join(tempDir, 'AGENTS.md');
    const agentsContent = await readFile(agentsPath, 'utf-8');

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Created/);
    assert.equal(result.stderr, '');
    assert.match(agentsContent, /# Agent Instructions/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('sc init exits with code 1 and writes to stderr when AGENTS.md cannot be created', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sc-init-failure-'));
  const blockingPath = path.join(tempDir, 'AGENTS.md');

  try {
    await mkdir(blockingPath);

    const result = await runScInit(tempDir);

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Error:/);
    assert.match(result.stderr, /AGENTS\.md/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
