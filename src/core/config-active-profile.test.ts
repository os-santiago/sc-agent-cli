import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('setGlobalActiveProfile updates only activeProfile in global config', async () => {
  const fakeHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const configDir = path.join(fakeHome, '.sc-agent');
  const configPath = path.join(configDir, 'config.json');
  const initialConfig = {
    model: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      temperature: 0.7,
      maxTokens: 4096,
      stream: true,
    },
    permissions: {
      autoApprove: ['read_file'],
    },
    activeProfile: 'ollama',
  };

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

  const moduleUrl = new URL('./config.js', import.meta.url).href;
  const script = `
    const { setGlobalActiveProfile } = await import(${JSON.stringify(moduleUrl)});
    await setGlobalActiveProfile('openai');
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const persisted = JSON.parse(await readFile(configPath, 'utf-8')) as typeof initialConfig;

  assert.equal(persisted.activeProfile, 'openai');
  assert.deepEqual(persisted.model, initialConfig.model);
  assert.deepEqual(persisted.permissions, initialConfig.permissions);
});
