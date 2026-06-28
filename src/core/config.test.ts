import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfigFile } from './config.js';

test('loadConfigFile returns null when the config file is missing', async () => {
  const missingPath = path.join(tmpdir(), 'sc-agent-config-missing', '.sc-agent.json');
  const result = await loadConfigFile(missingPath, 'project');
  assert.equal(result, null);
});

test('loadConfigFile reports invalid project config JSON with the file path', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-'));
  const configPath = path.join(tempDir, '.sc-agent.json');

  try {
    await writeFile(configPath, '{ invalid json', 'utf-8');

    await assert.rejects(
      () => loadConfigFile(configPath, 'project'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid project config at/);
        assert.ok(error.message.includes(configPath));
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('loadConfigFile rejects non-object project config JSON roots', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sc-agent-config-'));
  const configPath = path.join(tempDir, '.sc-agent.json');

  try {
    await writeFile(configPath, '["not", "an", "object"]', 'utf-8');

    await assert.rejects(
      () => loadConfigFile(configPath, 'project'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid project config at/);
        assert.match(error.message, /must contain a JSON object/);
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
