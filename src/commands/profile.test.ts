import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
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

interface CliTestEnv {
  cwd: string;
  home: string;
}

async function createCliTestEnv(config: unknown): Promise<CliTestEnv> {
  const root = await mkdtemp(path.join(tmpdir(), 'sc-profile-cli-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'workspace');
  const configDir = path.join(home, '.sc-agent');

  await Promise.all([
    mkdir(configDir, { recursive: true }),
    mkdir(cwd, { recursive: true }),
  ]);

  await writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  );

  return { cwd, home };
}

function runCli(args: string[], env: CliTestEnv): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: env.cwd,
      env: {
        ...process.env,
        HOME: env.home,
        USERPROFILE: env.home,
      },
    });

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

test('sc profile list explains how to recover when no profiles are configured', async () => {
  const env = await createCliTestEnv({
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
    activeProfile: undefined,
  });

  try {
    const result = await runCli(['profile', 'list'], env);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /No profiles available\./);
    assert.match(result.stdout, /sc config-init/);
    assert.match(result.stdout, /sc profile add <name>/);
    assert.equal(result.stderr.trim(), '');
  } finally {
    await rm(path.dirname(env.home), { recursive: true, force: true });
  }
});

test('sc profile use shows available profiles when the requested profile does not exist', async () => {
  const env = await createCliTestEnv({
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    },
    permissions: {
      autoApprove: ['read_file', 'list_dir', 'search_text'],
      denyPaths: ['.env', '.env.*', '**/*.key', '**/*.pem'],
    },
    profiles: {
      ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '<YOUR_OPENAI_KEY>',
        model: 'gpt-4o',
      },
    },
    activeProfile: 'ollama',
  });

  try {
    const result = await runCli(['profile', 'use', 'missing-profile'], env);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Profile "missing-profile" not found\./);
    assert.match(result.stdout, /Available profiles: ollama, openai/);
    assert.match(result.stdout, /sc profile list/);
    assert.equal(result.stderr.trim(), '');

    const configContents = await readFile(path.join(env.home, '.sc-agent', 'config.json'), 'utf-8');
    assert.match(configContents, /"activeProfile": "ollama"/);
  } finally {
    await rm(path.dirname(env.home), { recursive: true, force: true });
  }
});
