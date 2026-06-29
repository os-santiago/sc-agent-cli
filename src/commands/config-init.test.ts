import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function runConfigInit(homeDir: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/sc.js', 'config-init'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
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
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}

test('config-init prints actionable next steps after creating the config', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-init-'));
  const result = await runConfigInit(homeDir);
  const configPath = path.join(homeDir, '.sc-agent', 'config.json');

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, new RegExp(`Config initialized at ${configPath.replace(/\\/g, '\\\\')}`));
  assert.match(result.stdout, /Next steps:/);
  assert.match(result.stdout, /Replace any <YOUR_\*_KEY> placeholders/);
  assert.match(result.stdout, /sc profile use <name>/);
  assert.match(result.stdout, /sc chat/);
});
