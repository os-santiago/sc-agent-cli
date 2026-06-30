import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initConfig } from './config.js';

test('initConfig preserves an existing global config unless force is used', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    await initConfig(true);

    const configPath = path.join(tempHome, '.sc-agent', 'config.json');
    const initialConfig = await readFile(configPath, 'utf-8');

    await writeFile(configPath, '{"model":{"baseUrl":"http://example.com","model":"custom"}}', 'utf-8');

    await assert.rejects(
      () => initConfig(),
      /Global config already exists .*sc config-init --force/
    );

    const preservedConfig = await readFile(configPath, 'utf-8');
    assert.equal(
      preservedConfig,
      '{"model":{"baseUrl":"http://example.com","model":"custom"}}'
    );

    await initConfig(true);

    const overwrittenConfig = await readFile(configPath, 'utf-8');
    assert.equal(overwrittenConfig, initialConfig);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  }
});
