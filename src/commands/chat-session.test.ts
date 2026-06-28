import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('quiet mode prints only the final assistant response even when tools are used', async () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'sc-agent-home-'));
  const tempProject = mkdtempSync(join(tmpdir(), 'sc-agent-project-'));
  let requestCount = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    for await (const _chunk of req) {
      // Drain request body; this test varies responses by request count only.
    }

    requestCount += 1;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (requestCount === 1) {
      res.write(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_dir","arguments":"{\\"path\\":\\".\\"}"}}]}}]}\n\n'
      );
    } else {
      res.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n');
    }

    res.end('data: [DONE]\n\n');
  });

  try {
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    writeFileSync(
      join(tempProject, '.sc-agent.json'),
      JSON.stringify({
        model: {
          provider: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          model: 'test-model',
          stream: true,
        },
        permissions: {
          autoApprove: ['read_file', 'list_dir', 'search_text'],
        },
        activeProfile: null,
      }),
      'utf-8'
    );

    const result = spawnSync(process.execPath, [join(repoRoot, 'bin', 'sc.js'), 'chat', '-q', 'list files then say done'], {
      cwd: tempProject,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        FORCE_COLOR: '0',
      },
      encoding: 'utf-8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'done\n');
    assert.doesNotMatch(result.stdout, /Tools|Task Status|Assistant|┌|└|🔧/);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(tempProject, { recursive: true, force: true });
  }
});
