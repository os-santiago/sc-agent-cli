import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('loadConfig surfaces malformed global config files', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-global-bad-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    await mkdir(path.join(tempHome, '.sc-agent'), { recursive: true });
    await writeFile(path.join(tempHome, '.sc-agent', 'config.json'), '{"model":', 'utf-8');

    const configModule = await import(`./config.js?test=${Date.now()}-global`);

    await assert.rejects(
      () => configModule.loadConfig(),
      /Failed to parse global config at .*\.sc-agent[\\/]config\.json/
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

test('loadConfig surfaces malformed project config files', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-config-project-home-'));
  const tempProject = await mkdtemp(path.join(os.tmpdir(), 'sc-config-project-bad-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    await writeFile(path.join(tempProject, '.sc-agent.json'), '{"profiles":', 'utf-8');

    const configModule = await import(`./config.js?test=${Date.now()}-project`);

    await assert.rejects(
      () => configModule.loadConfig(tempProject),
      /Failed to parse project config at .*\.sc-agent\.json/
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
