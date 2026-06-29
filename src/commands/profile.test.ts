import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import prompts from 'prompts';
import { addProfile } from './profile.js';

function captureConsoleLogs(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(' '));
  };

  return {
    output,
    restore: () => {
      console.log = originalLog;
    },
  };
}

test('addProfile exits cleanly when the profile name prompt is cancelled', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-add-cancelled-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const { output, restore } = captureConsoleLogs();

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  prompts.inject([new Error('cancelled')]);

  try {
    await addProfile();

    assert.match(output.join('\n'), /Cancelled/);
    assert.equal(existsSync(path.join(tempHome, '.sc-agent', 'config.json')), false);
  } finally {
    restore();

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

test('addProfile does not save a partial profile when the details prompt is cancelled', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-add-cancelled-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const { output, restore } = captureConsoleLogs();
  const configPath = path.join(tempHome, '.sc-agent', 'config.json');

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  prompts.inject([new Error('cancelled')]);

  try {
    await addProfile('work');

    assert.match(output.join('\n'), /Cancelled/);
    assert.equal(existsSync(configPath), false);
  } finally {
    restore();

    if (existsSync(configPath)) {
      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8')) as {
        profiles?: Record<string, { baseUrl?: string; model?: string }>;
      };
      assert.equal(savedConfig.profiles?.work, undefined);
    }

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
