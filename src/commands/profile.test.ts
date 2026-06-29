import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('profile list shows profiles in alphabetical order', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sc-agent-profile-list-'));
  const homeDir = path.join(tempDir, 'home');

  try {
    await mkdir(path.join(homeDir, '.sc-agent'), { recursive: true });
    await writeFile(
      path.join(homeDir, '.sc-agent', 'config.json'),
      JSON.stringify({
        model: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.2',
          temperature: 0.7,
          maxTokens: 4096,
          stream: true,
        },
        profiles: {
          zebra: { model: 'z-model', baseUrl: 'https://z.example/v1' },
          alpha: { model: 'a-model', baseUrl: 'https://a.example/v1' },
          middle: { model: 'm-model', baseUrl: 'https://m.example/v1' },
        },
        activeProfile: 'middle',
      }, null, 2),
      'utf-8'
    );

    const result = await runCli(['profile', 'list'], {
      HOME: homeDir,
      USERPROFILE: homeDir,
    });

    assert.equal(result.code, 0);
    assert.deepEqual(extractProfileNames(result.stdout), [
      'alpha',
      'anthropic',
      'llama-3.3-70b',
      'middle',
      'nvidia',
      'ollama',
      'openai',
      'zebra',
    ]);
    assert.match(result.stdout, /middle \(active\)/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function extractProfileNames(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(':') && !line.startsWith('📋'))
    .map((line) => line.replace(/\s+\(active\)$/, ''));
}

async function runCli(
  args: string[],
  envOverrides: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const cliPath = path.resolve(process.cwd(), 'bin', 'sc.js');

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
