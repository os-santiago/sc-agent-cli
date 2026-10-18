// Registry + tool.ts contract coverage (#544, parent #481).
//
// The registry is the dispatch surface the agent calls through: ALL_TOOLS is
// the built-in inventory, getToolByName resolves a call to its tool, and
// registerPluginTools merges external tools behind the standard permission
// gate (#485).
//
// LOCKED-IN contract: a denied tool invoked through the registry rejects with
// the denied-result shape the tool.ts Tool.execute contract produces today —
// a rejected `Error('Permission denied by user')`. Not a sentinel string, not
// a resolved result object. If the deny path ever moves to a structured
// result shape, this file is the deliberate place to update the contract.

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import type { ProjectConfig } from '../core/types.js';
import type { Tool, ToolContext } from './tool.js';

// Same mock shapes as permissions-matrix.test.ts — prompts approves by
// default (select → 'yes'), chalk is a pass-through, box borders are empty.
vi.mock('prompts', () => ({ default: vi.fn().mockResolvedValue({ choice: 'yes', approved: true }) }));
vi.mock('chalk', () => ({ default: new Proxy({}, { get: () => (s: string) => s }) }));
vi.mock('../utils/box-drawing.js', () => ({
  boxHeader: () => '',
  boxFooter: () => '',
}));

import prompts from 'prompts';
import { ALL_TOOLS, getToolByName, registerPluginTools } from './registry.js';
import { clearSessionPermissions } from '../utils/permissions.js';

// Mirrors DEFAULT_CONFIG.permissions.autoApprove in src/core/config.ts —
// the tools a default install never prompts for.
const DEFAULT_AUTO_APPROVE = [
  'read_file', 'list_dir', 'search_text', 'web_fetch', 'memory_read', 'code_query', 'repo_probe',
];

function makeConfig(overrides: { autoApprove?: string[] } = {}): ProjectConfig {
  return {
    model: { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'test' },
    permissions: {
      autoApprove: overrides.autoApprove ?? [...DEFAULT_AUTO_APPROVE],
    },
  };
}

function pluginTool(name: string, onRun?: (args: Record<string, unknown>) => void): Tool {
  return {
    definition: {
      type: 'function',
      function: { name, description: 'registry test plugin', parameters: { type: 'object', properties: {} } },
    },
    async execute(args) {
      onRun?.(args);
      return `${name}-result`;
    },
  };
}

beforeEach(() => {
  clearSessionPermissions();
  vi.clearAllMocks();
});

// NOTE: registerPluginTools mutates ALL_TOOLS for the rest of this file, so
// the inventory assertions run first while the registry is still pristine
// (vitest isolates the module graph per test file).

describe('registry inventory', () => {
  const EXPECTED_BUILT_INS = [
    'read_file', 'write_file', 'edit_file', 'list_dir', 'search_text',
    'run_shell', 'web_fetch', 'memory_read', 'memory_write', 'git',
    'code_query', 'mcp_validate', 'repo_probe',
  ];

  test('ALL_TOOLS exposes exactly the built-in tool set', () => {
    assert.deepEqual(
      ALL_TOOLS.map((t) => t.definition.function.name).sort(),
      [...EXPECTED_BUILT_INS].sort(),
    );
  });

  test('every registered tool conforms to the Tool shape from tool.ts', () => {
    for (const tool of ALL_TOOLS) {
      assert.equal(tool.definition.type, 'function', tool.definition.function.name);
      assert.equal(typeof tool.definition.function.name, 'string');
      assert.ok(tool.definition.function.description, `${tool.definition.function.name} must carry a description`);
      assert.equal(typeof tool.execute, 'function', tool.definition.function.name);
    }
  });

  test('getToolByName resolves a built-in and returns undefined for unknown names', () => {
    assert.equal(getToolByName('read_file')!.definition.function.name, 'read_file');
    assert.equal(getToolByName('definitely_not_a_tool'), undefined);
  });
});

describe('registerPluginTools', () => {
  test('a new external tool joins the registry reachable via getToolByName', () => {
    const before = ALL_TOOLS.length;
    registerPluginTools([pluginTool('reg544_new')]);
    assert.equal(ALL_TOOLS.length, before + 1);
    assert.equal(getToolByName('reg544_new')!.definition.function.name, 'reg544_new');
  });

  test('name collisions are skipped with a warning — built-ins can never be shadowed', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const before = ALL_TOOLS.length;
      registerPluginTools([pluginTool('write_file')]);
      assert.equal(ALL_TOOLS.length, before, 'a colliding tool must not be registered');
      assert.ok(
        err.mock.calls.some((c) => String(c[0]).includes('"write_file"') && String(c[0]).includes('skipped')),
        'expected a skip warning naming the colliding tool',
      );
    } finally {
      err.mockRestore();
    }
    // The resolved write_file is still the real built-in.
    assert.match(getToolByName('write_file')!.definition.function.description, /Write content/);
  });

  test('the registered wrapper preserves the tool definition object', () => {
    const tool = pluginTool('reg544_defid');
    registerPluginTools([tool]);
    assert.equal(getToolByName('reg544_defid')!.definition, tool.definition);
  });
});

describe('denied-result shape (locked in — #544)', () => {
  test('a denied built-in invoked through the registry rejects with Error("Permission denied by user")', async () => {
    const ctx: ToolContext = { workspaceRoot: process.cwd(), config: makeConfig() };
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });

    const tool = getToolByName('write_file')!;
    await assert.rejects(
      tool.execute({ path: 'x.txt', content: 'nope' }, ctx),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'denial must reject with an Error, not resolve a sentinel string');
        assert.equal(err.message, 'Permission denied by user');
        return true;
      },
    );
  });

  test('a denied external tool produces the identical shape and never runs execute()', async () => {
    let ran = 0;
    registerPluginTools([pluginTool('reg544_spy', () => ran++)]);
    const gated = getToolByName('reg544_spy')!;

    const ctx: ToolContext = { workspaceRoot: process.cwd(), config: makeConfig() };
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'no' });
    await assert.rejects(
      gated.execute({}, ctx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'Permission denied by user');
        return true;
      },
    );
    assert.equal(ran, 0, 'a denied tool must never reach execute()');
  });

  test('an approved external tool runs and returns its result', async () => {
    let ran = 0;
    registerPluginTools([pluginTool('reg544_ok', () => ran++)]);
    const gated = getToolByName('reg544_ok')!;

    const ctx: ToolContext = { workspaceRoot: process.cwd(), config: makeConfig() };
    vi.mocked(prompts).mockResolvedValueOnce({ choice: 'yes' });
    assert.equal(await gated.execute({}, ctx), 'reg544_ok-result');
    assert.equal(ran, 1);
  });
});
