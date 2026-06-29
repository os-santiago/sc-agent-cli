import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function withTempHome(
  config: Record<string, unknown>,
  callback: (homeDir: string) => void
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'sc-chat-session-test-'));

  try {
    const configDir = path.join(homeDir, '.sc-agent');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify(config, null, 2),
      'utf-8'
    );
    callback(homeDir);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

function runChat(homeDir: string, input: string) {
  return spawnSync(process.execPath, ['bin/sc.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    input,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

test('chat /model suggests creating a profile when none are configured', async () => {
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
    (homeDir) => {
      const result = runChat(homeDir, '/model\nexit\n');

      assert.equal(result.status, 0);
      assert.match(result.stdout, /No profiles available\./);
      assert.match(result.stdout, /sc profile add <name>/);
    }
  );
});
