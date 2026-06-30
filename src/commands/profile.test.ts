import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('profile use exits non-zero and lists available profiles when the profile does not exist', async () => {
  const fakeHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const configDir = path.join(fakeHome, '.sc-agent');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      profiles: {
        ollama: {
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.2',
        },
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          apiKey: 'test-key',
        },
      },
      activeProfile: 'ollama',
    }),
    'utf-8'
  );

  const cliPath = path.resolve(process.cwd(), 'dist', 'cli.js');
  const result = await runNode([cliPath, 'profile', 'use', 'missing-profile'], fakeHome);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Error: Profile "missing-profile" not found\./);
  assert.match(result.stderr, /Available profiles:/);
  assert.match(result.stderr, /\bollama\b/);
  assert.match(result.stderr, /\bopenai\b/);
});

function runNode(args: string[], fakeHome: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}
