// mcp_validate tool coverage (#545, parent #544): execute() + the
// callMcpInitialize child-process handshake — response parse, capability /
// tool listing, non-zero exit, spawn failure, timeout and the permission
// gate.
//
// The "server" is a real child process: `node -e <script>` via
// process.execPath (no spaces in the script — `args` is whitespace-split),
// which is deterministic on every OS and needs no MCP fixture on disk.

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectConfig } from '../core/types.js';
import type { ToolContext } from './tool.js';

vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

import prompts from 'prompts';
import { mcpValidateTool } from './mcp-validate-tool.js';
import { clearSessionPermissions } from '../utils/permissions.js';

const NODE = process.execPath;

// Space-free `node -e` bodies (the tool splits `args` on /\s+/ — whitespace
// inside the script, even inside string literals, would split mid-token).
const RESPOND_OK =
  'console.log(JSON.stringify({result:{serverInfo:{name:"fakemcp",version:"1.2.3"},capabilities:{tools:{},prompts:{}},tools:[{name:"echo",description:"echoes",inputSchema:{text:{}}}]}}))';
const RESPOND_BARE = 'console.log(JSON.stringify({result:{serverInfo:{name:"bare"}}}))';
const RESPOND_NON_JSON = 'console.log("serverInfo")';
const EXIT_3 = 'process.exit(3)';
const STDERR_THEN_EXIT = 'process.stderr.write("warn");process.exit(1)';
const HANG = 'setTimeout(()=>{},9000)';

function makeConfig(): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    permissions: { autoApprove: [] },
  };
}

function ctx(autoApprove = true): ToolContext {
  return { workspaceRoot: process.cwd(), config: makeConfig(), autoApprove };
}

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
});

describe('mcp_validate', () => {
  test('a denied prompt rejects before spawning anything', async () => {
    const context = ctx(false);
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      mcpValidateTool.execute({ command: NODE, args: `-e ${RESPOND_OK}` }, context),
      /Permission denied by user/,
    );
  });

  test('a responding server reports name, version, capabilities and tools', async () => {
    const out = await mcpValidateTool.execute(
      { command: NODE, args: `-e ${RESPOND_OK}` },
      ctx(),
    );
    assert.match(out, /✓ MCP Server responded:/);
    assert.match(out, /Name:\s+fakemcp/);
    assert.match(out, /Version:\s+1\.2\.3/);
    assert.match(out, /Capabilities: tools, prompts/);
    assert.match(out, /Tools \(1\):/);
    assert.match(out, /• echo \(1 params\)/);
    assert.match(out, /echoes/);
  });

  test('a minimal response falls back to unknown version and no tools', async () => {
    const out = await mcpValidateTool.execute(
      { command: NODE, args: `-e ${RESPOND_BARE}` },
      ctx(),
    );
    assert.match(out, /Name:\s+bare/);
    assert.match(out, /Version:\s+unknown/);
    assert.match(out, /Tools: none detected/);
  });

  test('non-JSON output containing a marker still resolves as a response', async () => {
    const out = await mcpValidateTool.execute(
      { command: NODE, args: `-e ${RESPOND_NON_JSON}` },
      ctx(),
    );
    assert.match(out, /✓ MCP Server responded:/);
  });

  test('a non-zero exit without a response reports the exit code', async () => {
    const out = await mcpValidateTool.execute(
      { command: NODE, args: `-e ${EXIT_3}` },
      ctx(),
    );
    assert.match(out, /⚠ MCP Server test failed:/);
    assert.match(out, /Process exited with code 3/);
  });

  test('stderr output is consumed alongside stdout', async () => {
    const out = await mcpValidateTool.execute(
      { command: NODE, args: `-e ${STDERR_THEN_EXIT}` },
      ctx(),
    );
    assert.match(out, /⚠ MCP Server test failed:/);
    assert.match(out, /Process exited with code 1/);
  });

  test('a nonexistent command reports a start failure', async () => {
    const out = await mcpValidateTool.execute(
      { command: 'sc-mcp-definitely-missing-binary', args: '' },
      ctx(),
    );
    assert.match(out, /⚠ MCP Server test failed:/);
    assert.match(out, /Failed to start:/);
  });

  test('a hung server is killed and reported as a timeout', async () => {
    const out = await mcpValidateTool.execute(
      { command: NODE, args: `-e ${HANG}`, timeout: 150 },
      ctx(),
    );
    assert.match(out, /⚠ MCP Server test failed:/);
    // The manual timer and spawn()'s own `timeout` option share the deadline —
    // either fires first, both surface as a failure with a timeout/exit detail.
    assert.match(out, /Timeout after 150ms|did not respond to initialize|exited with code/);
  });
});
