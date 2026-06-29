import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('loadConfig surfaces invalid global config JSON with its path', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-invalid-global-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const configDir = path.join(tempHome, '.sc-agent');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'config.json'), '{ invalid json', 'utf-8');

    const configModule = await import(`./config.js?test=${Date.now()}`);

    await assert.rejects(
      () => configModule.loadConfig(),
      /Invalid global config at .*config\.json:/
    );
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

    await rm(tempHome, { recursive: true, force: true });
  }
});

test('loadConfig surfaces invalid project config JSON with its path', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-invalid-project-home-'));
  const tempProject = await mkdtemp(path.join(os.tmpdir(), 'sc-config-invalid-project-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    await writeFile(path.join(tempProject, '.sc-agent.json'), '{ invalid json', 'utf-8');

    const configModule = await import(`./config.js?test=${Date.now()}`);

    await assert.rejects(
      () => configModule.loadConfig(tempProject),
      /Invalid project config at .*\.sc-agent\.json:/
    );
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

    await rm(tempProject, { recursive: true, force: true });
    await rm(tempHome, { recursive: true, force: true });
  }
});
