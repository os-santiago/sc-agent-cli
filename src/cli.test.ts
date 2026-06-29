import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('async command failures are reported as CLI errors without a stack trace', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'sc-agent-cli-home-'));
  const configDir = join(homeDir, '.sc-agent');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), '{"activeProfile":"openai"}', 'utf8');

  const cliPath = fileURLToPath(new URL('../bin/sc.js', import.meta.url));
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync(process.execPath, [cliPath, 'profile', 'list'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      USERPROFILE: homeDir,
      HOME: homeDir,
      SC_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      NVIDIA_API_KEY: '',
    },
  });

  rmSync(homeDir, { recursive: true, force: true });

  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), '');
  assert.match(result.stderr, /Error: OpenAI API requires apiKey in config/);
  assert.doesNotMatch(result.stderr, /at loadConfig/);
});
