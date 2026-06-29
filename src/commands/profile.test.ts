import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'bin', 'sc.js');

test('profile add does not overwrite an existing profile', () => {
  const tempHome = mkdtempSync(path.join(tmpdir(), 'sc-agent-profile-add-'));
  const configDir = path.join(tempHome, '.sc-agent');
  const configPath = path.join(configDir, 'config.json');

  mkdirSync(configDir, { recursive: true });

  const originalConfig = {
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
      denyPaths: ['.env'],
    },
    profiles: {
      demo: {
        baseUrl: 'https://example.test/v1',
        model: 'original-model',
      },
    },
    activeProfile: 'demo',
  };

  writeFileSync(configPath, JSON.stringify(originalConfig, null, 2), 'utf-8');

  try {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'profile', 'add', 'demo'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: tempHome,
          USERPROFILE: tempHome,
        },
        encoding: 'utf-8',
        timeout: 3000,
      }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /Profile "demo" already exists/);
    assert.match(result.stdout, /Use "sc profile use demo" to switch to it\./);

    const savedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.deepEqual(savedConfig.profiles.demo, originalConfig.profiles.demo);
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});
