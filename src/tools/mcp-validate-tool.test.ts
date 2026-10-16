// Unit coverage for the mcp_validate tool (#543). child_process.spawn and the
// permission layer are mocked: happy paths drive a fake stdio MCP child and
// assert the rendered report, the denial test proves the child is never
// spawned, and error paths cover timeout / spawn failure / silent exit /
// malformed args per the tool's documented contract.

import { test, describe, vi, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ToolContext } from './tool.js';

const mocks = vi.hoisted(() => ({
  requestPermission: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../utils/permissions.js', () => ({ requestPermission: mocks.requestPermission }));
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: mocks.spawn };
});

import { mcpValidateTool } from './mcp-validate-tool.js';

interface FakeChild extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

// Install a spawn mock that returns a controllable child and runs `run`
// asynchronously — after the tool has attached its stdio/close/error
// handlers.
function makeChild(run: (child: FakeChild) => void): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = { write: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  mocks.spawn.mockImplementation(() => {
    setImmediate(() => run(child));
    return child;
  });
  return child;
}

function makeCtx(): ToolContext {
  return {
    workspaceRoot: process.cwd(),
    config: {
      model: { provider: 'openai-compatible', baseUrl: 'http://provider.test/v1', model: 'test-model' },
    },
  };
}

const exec = (args: Record<string, unknown>, ctx: ToolContext = makeCtx()) =>
  mcpValidateTool.execute(args, ctx);

function respondWith(payload: unknown) {
  return (child: FakeChild) => {
    child.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
    child.emit('close', 0);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestPermission.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('mcp_validate — happy path', () => {
  test('a clean initialize handshake reports server info, capabilities and tools', async () => {
    const child = makeChild(
      respondWith({
        jsonrpc: '2.0',
        id: '1',
        result: {
          serverInfo: { name: 'test-server', version: '1.2.3' },
          capabilities: { tools: {}, logging: {} },
          tools: [
            { name: 'echo', description: 'echoes input', inputSchema: { text: {}, extra: {} } },
          ],
        },
      }),
    );

    const out = await exec({ command: 'test-server' });
    assert.match(out, /✓ MCP Server responded:/);
    assert.match(out, /Name:\s+test-server/);
    assert.match(out, /Version:\s+1\.2\.3/);
    assert.match(out, /Capabilities: tools, logging/);
    assert.match(out, /Tools \(1\):/);
    assert.match(out, /• echo \(2 params\)/);
    assert.match(out, /echoes input/);

    // The initialize handshake was written to the child's stdin.
    const written = child.stdin.write.mock.calls[0][0] as string;
    assert.match(written, /"method":"initialize"/);
    assert.match(written, /"protocolVersion":"0\.1\.0"/);
    assert.match(written, /"clientInfo":\{"name":"sc-agent"/);
  });

  test('a server with no advertised tools reports "none detected"', async () => {
    makeChild(
      respondWith({
        jsonrpc: '2.0',
        id: '1',
        result: { serverInfo: { name: 'bare', version: '0.1' }, capabilities: {} },
      }),
    );
    const out = await exec({ command: 'bare' });
    assert.match(out, /✓ MCP Server responded:/);
    assert.match(out, /Tools: none detected \(or not advertised\)/);
    assert.ok(!/Capabilities:/.test(out));
  });

  test('non-JSON output that still answers the handshake counts as a response', async () => {
    makeChild((child) => {
      child.stdout.emit('data', Buffer.from('initialize handshake acknowledged\n'));
      child.emit('close', 0);
    });
    const out = await exec({ command: 'bin/mcp-srv' });
    assert.match(out, /✓ MCP Server responded:/);
    assert.match(out, /Name:\s+mcp-srv/);
    assert.match(out, /Version:\s+unknown/);
  });

  test('the args string is split into spawn argv', async () => {
    makeChild(respondWith({ jsonrpc: '2.0', id: '1', result: { serverInfo: { name: 'x' } } }));
    await exec({ command: 'node', args: 'srv.js  --stdio   -v' });
    assert.equal(mocks.spawn.mock.calls[0][0], 'node');
    assert.deepEqual(mocks.spawn.mock.calls[0][1], ['srv.js', '--stdio', '-v']);
  });

  test('timeout defaults to 10000ms and honors an explicit value', async () => {
    makeChild(respondWith({ jsonrpc: '2.0', id: '1', result: { serverInfo: { name: 'x' } } }));
    await exec({ command: 'srv' });
    const opts = mocks.spawn.mock.calls[0][2];
    assert.equal(opts.timeout, 10000);
    assert.equal(opts.windowsHide, true);
    assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe']);

    mocks.spawn.mockClear();
    makeChild(respondWith({ jsonrpc: '2.0', id: '1', result: { serverInfo: { name: 'x' } } }));
    await exec({ command: 'srv', timeout: 5000 });
    assert.equal(mocks.spawn.mock.calls[0][2].timeout, 5000);
  });

  test('the spawned child receives a credential-scrubbed environment (#471)', async () => {
    vi.stubEnv('SC_API_KEY', 'should-never-leak');
    vi.stubEnv('TEST_AUTH_TOKEN', 'should-never-leak');
    makeChild(respondWith({ jsonrpc: '2.0', id: '1', result: { serverInfo: { name: 'x' } } }));
    await exec({ command: 'srv' });
    const env = mocks.spawn.mock.calls[0][2].env;
    assert.ok(!('SC_API_KEY' in env), 'SC_* vars must not reach the child');
    assert.ok(!('TEST_AUTH_TOKEN' in env), 'credential-shaped vars must not reach the child');
    assert.equal(env.PATH, process.env.PATH);
  });
});

describe('mcp_validate — error and denial contract', () => {
  test('a server exiting without answering reports the exit code', async () => {
    makeChild((child) => child.emit('close', 1));
    const out = await exec({ command: 'crasher' });
    assert.match(out, /⚠ MCP Server test failed:/);
    assert.match(out, /Error: Process exited with code 1/);
  });

  test('a spawn failure reports Failed to start', async () => {
    makeChild((child) => child.emit('error', new Error('spawn ENOENT')));
    const out = await exec({ command: 'missing-binary' });
    assert.match(out, /⚠ MCP Server test failed:/);
    assert.match(out, /Error: Failed to start: spawn ENOENT/);
  });

  test('an unresponsive server is killed and reports a timeout', async () => {
    const child = makeChild(() => {
      /* never responds */
    });
    const out = await exec({ command: 'sleepy', timeout: 25 });
    assert.match(out, /⚠ MCP Server test failed:/);
    assert.match(out, /Error: Timeout after 25ms/);
    assert.equal(child.kill.mock.calls.length, 1);
  });

  test('denied permission rejects and the server is never spawned', async () => {
    mocks.requestPermission.mockResolvedValue(false);
    await assert.rejects(
      exec({ command: 'test-server' }),
      /Permission denied by user/,
    );
    assert.equal(mocks.requestPermission.mock.calls.length, 1);
    assert.equal(mocks.spawn.mock.calls.length, 0);
  });

  test('the tool self-gates as "mcp_validate" with the caller args', async () => {
    makeChild(respondWith({ jsonrpc: '2.0', id: '1', result: { serverInfo: { name: 'x' } } }));
    const args = { command: 'srv', args: '--flag' };
    const ctx = makeCtx();
    await exec(args, ctx);
    const perm = mocks.requestPermission.mock.calls[0][0];
    assert.equal(perm.toolName, 'mcp_validate');
    assert.equal(perm.args, args);
    assert.equal(perm.config, ctx.config);
  });

  test('a missing command propagates the spawn argument error', async () => {
    // The schema requires `command`; when it is absent the tool delegates the
    // failure to child_process.spawn, which rejects synchronously inside the
    // initialize promise.
    mocks.spawn.mockImplementation(() => {
      throw new TypeError('The "file" argument must be of type string. Received undefined');
    });
    await assert.rejects(exec({}), /must be of type string/);
    assert.equal(mocks.spawn.mock.calls[0][0], undefined);
  });

  test('a non-string args value rejects before the permission layer runs', async () => {
    await assert.rejects(exec({ command: 'srv', args: 42 }), TypeError);
    assert.equal(mocks.requestPermission.mock.calls.length, 0);
    assert.equal(mocks.spawn.mock.calls.length, 0);
  });
});
