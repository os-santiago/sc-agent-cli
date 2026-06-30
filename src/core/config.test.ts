import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initConfig } from './config.js';

test('initConfig refuses to overwrite an existing config without force', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-init-'));
  const configPath = path.join(projectRoot, 'config.json');

  await writeFile(configPath, '{"existing":true}', 'utf-8');

  await assert.rejects(
    () => initConfig({ configPath }),
    /Global config already exists .*sc config-init --force/
  );
});

test('initConfig overwrites an existing config when force is enabled', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-init-force-'));
  const configPath = path.join(projectRoot, 'config.json');

  await writeFile(configPath, '{"existing":true}', 'utf-8');
  await initConfig({ configPath, force: true });

  const content = await readFile(configPath, 'utf-8');

  assert.match(content, /"activeProfile": "ollama"/);
  assert.match(content, /"model": "llama3\.2"/);
});
