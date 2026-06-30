import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import prompts from 'prompts';

const sharedTempHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-profile-'));
const profileModulePromise = loadProfileModule(sharedTempHome, 'test-suite');

async function loadProfileModule(tempHome: string, label: string) {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const moduleUrl = new URL(`./profile.js?${label}`, import.meta.url).href;
    return await import(moduleUrl);
  } finally {
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousUserProfile;
  }
}

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const originalLog = console.log;
  const messages: string[] = [];

  console.log = (...args: unknown[]) => {
    messages.push(args.map(String).join(' '));
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
    prompts.inject([]);
  }

  return messages;
}

test('addProfile cancels cleanly before writing config', async () => {
  const { addProfile } = await profileModulePromise;

  prompts.inject([new Error('cancelled')]);
  const logs = await captureLogs(() => addProfile());

  const configPath = path.join(sharedTempHome, '.sc-agent', 'config.json');

  await assert.rejects(access(configPath, constants.F_OK));
  assert.ok(logs.some((line) => line.includes('Profile creation cancelled')));
  assert.ok(!logs.some((line) => line.includes('Profile name is required')));
});

test('addProfile trims required values before saving', async () => {
  const { addProfile } = await profileModulePromise;

  prompts.inject(['  http://localhost:1234/v1  ', '  llama3.2-custom  ', '   ']);
  const logs = await captureLogs(() => addProfile('  local-dev  '));

  const configPath = path.join(sharedTempHome, '.sc-agent', 'config.json');
  const savedConfig = JSON.parse(await readFile(configPath, 'utf-8')) as {
    profiles?: Record<string, { baseUrl?: string; model?: string; apiKey?: string }>;
  };

  assert.ok(logs.some((line) => line.includes('added successfully')));
  assert.deepEqual(savedConfig.profiles?.['local-dev'], {
    baseUrl: 'http://localhost:1234/v1',
    model: 'llama3.2-custom',
  });
});
