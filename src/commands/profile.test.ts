import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function withTempHome(config: unknown, callback: () => Promise<void>): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-test-'));
  const originalEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
  };

  try {
    const configDir = path.join(homeDir, '.sc-agent');
    const drive = path.parse(homeDir).root.replace(/[\\\/]+$/, '');

    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.HOMEDRIVE = drive;
    process.env.HOMEPATH = homeDir.slice(drive.length);

    await callback();
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await rm(homeDir, { recursive: true, force: true });
  }
}

test('profile list shows guidance when no profiles are configured', async () => {
  await withTempHome(
    {
      model: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
      profiles: null,
      activeProfile: null,
    },
    async () => {
      const output: string[] = [];
      const originalLog = console.log;

      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      };

      try {
        const { listProfiles } = await import(`./profile.js?case=${Date.now()}`);
        await listProfiles();
      } finally {
        console.log = originalLog;
      }

      const rendered = output.join('\n');
      assert.match(rendered, /No profiles configured yet\./);
      assert.match(rendered, /sc profile add <name>/);
      assert.match(rendered, /sc config-init/);
    },
  );
});
