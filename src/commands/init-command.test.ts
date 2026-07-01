import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../../bin/sc.js', import.meta.url));

interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runInitCli(cwd: string): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'init'], { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test('sc init exits non-zero and writes the failure to stderr when AGENTS.md cannot be created', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'sc-init-failure-'));

  try {
    await mkdir(path.join(tempRoot, 'AGENTS.md'));

    const result = await runInitCli(tempRoot);

    assert.equal(result.code, 1);
    assert.equal(result.stdout.trim(), '');
    assert.match(result.stderr, /Error: Failed to create AGENTS\.md:/);
    assert.match(result.stderr, /AGENTS\.md/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('sc init creates AGENTS.md and exits successfully in a fresh directory', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'sc-init-success-'));

  try {
    const result = await runInitCli(tempRoot);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Created .*AGENTS\.md/);
    assert.equal(result.stderr.trim(), '');

    const agentsPath = path.join(tempRoot, 'AGENTS.md');
    const [fileInfo, content] = await Promise.all([
      stat(agentsPath),
      readFile(agentsPath, 'utf-8'),
    ]);

    assert.ok(fileInfo.isFile());
    assert.match(content, /# Agent Instructions/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
