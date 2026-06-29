import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

test('model command suggests how to recover when no profiles exist', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-chat-model-empty-'));
  const configDir = path.join(tempHome, '.sc-agent');
  const configPath = path.join(configDir, 'config.json');

  await mkdir(configDir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
        temperature: 0.7,
        maxTokens: 4096,
        stream: true,
      },
      permissions: {
        autoApprove: ['read_file', 'list_dir', 'search_text'],
        denyPaths: ['.env', '.env.*', '**/*.key', '**/*.pem'],
      },
      profiles: null,
    }, null, 2),
    'utf-8'
  );

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(process.cwd(), 'bin', 'sc.js'), 'chat', '--quiet'],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            HOME: tempHome,
            USERPROFILE: tempHome,
          },
          stdio: 'pipe',
        }
      );

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
        if (code !== 0) {
          reject(new Error(`CLI exited with code ${code}: ${stderr}`));
          return;
        }

        resolve(stripAnsi(stdout));
      });

      child.stdin.write('/model\n');
      child.stdin.write('quit\n');
      child.stdin.end();
    });

    assert.match(output, /No profiles available\./);
    assert.match(output, /sc profile add <name>/);
    assert.match(output, /sc config-init --force/);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
