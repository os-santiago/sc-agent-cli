import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('listProfiles shows guidance when no profiles are configured', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'sc-agent-profile-list-'));
  const configDir = path.join(tempHome, '.sc-agent');
  const configPath = path.join(configDir, 'config.json');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const logs: string[] = [];

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({ profiles: null }, null, 2), 'utf-8');

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    const { listProfiles } = await import(`./profile.js?empty=${Date.now()}`);
    await listProfiles();
  } finally {
    console.log = originalLog;

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

  const output = stripAnsi(logs.join('\n'));
  assert.match(output, /No profiles configured yet\./);
  assert.match(output, /sc profile add <name>/);
});

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}
