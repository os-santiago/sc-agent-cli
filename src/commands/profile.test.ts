import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import prompts from 'prompts';

const DEFAULT_CONFIG = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    temperature: 0.7,
    maxTokens: 4096,
    stream: true,
  },
  permissions: {
    autoApprove: ['read_file', 'list_dir', 'search_text'],
    denyPaths: ['.env', '.env.*', '**/*.key', '**/*.pem'],
  },
  profiles: {
    ollama: {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    },
  },
  activeProfile: 'ollama',
};

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const tempHome = path.join(tmpdir(), `sc-agent-profile-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  await mkdir(path.join(tempHome, '.sc-agent'), { recursive: true });
  await writeFile(
    path.join(tempHome, '.sc-agent', 'config.json'),
    JSON.stringify(DEFAULT_CONFIG, null, 2),
    'utf-8'
  );

  try {
    await fn();
  } finally {
    prompts.inject([]);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
  }
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };

  return {
    lines,
    restore: () => {
      console.log = originalLog;
    },
  };
}

test('useProfile shows Cancelled when selection is aborted', async () => {
  await withTempHome(async () => {
    const { useProfile } = await import('./profile.js');
    const logs = captureLogs();
    prompts.inject([undefined]);

    try {
      await useProfile();
    } finally {
      logs.restore();
    }

    assert.equal(logs.lines.length, 1);
    assert.match(logs.lines[0], /Cancelled/);
    assert.doesNotMatch(logs.lines[0], /Profile name is required/);
  });
});

test('removeProfile shows Cancelled when selection is aborted', async () => {
  await withTempHome(async () => {
    const { removeProfile } = await import('./profile.js');
    const logs = captureLogs();
    prompts.inject([undefined]);

    try {
      await removeProfile();
    } finally {
      logs.restore();
    }

    assert.equal(logs.lines.length, 1);
    assert.match(logs.lines[0], /Cancelled/);
    assert.doesNotMatch(logs.lines[0], /Profile name is required/);
  });
});
