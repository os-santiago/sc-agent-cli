import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('useProfile can recover from an invalid active profile without requiring a valid API key', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-test-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const stdoutChunks: string[] = [];

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    const configPath = path.join(tempHome, '.sc-agent', 'config.json');
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        {
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
            denyPaths: ['.env'],
          },
          profiles: {
            ollama: {
              baseUrl: 'http://localhost:11434/v1',
              model: 'llama3.2',
            },
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o',
            },
          },
          activeProfile: 'openai',
        },
        null,
        2
      ),
      'utf-8'
    );

    const profileModule = await import(`./profile.js?test=${Date.now()}`);
    await profileModule.useProfile('ollama');

    const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
    assert.equal(savedConfig.activeProfile, 'ollama');
    assert.match(stdoutChunks.join(''), /Switched to profile "ollama"/);
  } finally {
    process.stdout.write = originalStdoutWrite;

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
