import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeToolCall, executeToolCalls, type ToolExecutionDeps, type ToolUseRecord } from './tool-execution.js';
import { RunAudit } from './audit.js';
import type { ToolCall } from '../types.js';
import type { ProjectConfig } from '../types.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sc-toolexec-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function makeDeps(overrides: Partial<ToolExecutionDeps> = {}): ToolExecutionDeps {
  const toolsUsed: ToolUseRecord[] = [];
  return {
    toolContext: {
      workspaceRoot: workspace,
      config: { model: { provider: 'openai-compatible', baseUrl: 'http://x', model: 'm' } } as ProjectConfig,
      autoApprove: true,
    },
    shellType: 'bash',
    readOnlyPhase: false,
    isMultiple: true,
    iteration: 1,
    audit: new RunAudit(undefined),
    toolsUsed,
    log: () => {},
    emitToolStart: () => {},
    emitToolComplete: () => {},
    emitToolError: () => {},
    onToolRun: () => {},
    ...overrides,
  };
}

function call(name: string, args: string, id = name): ToolCall {
  return { id, type: 'function', function: { name, arguments: args } };
}

test('executeToolCall returns an error result for unknown tools instead of throwing', async () => {
  const deps = makeDeps();
  const result = await executeToolCall(deps, call('nonexistent_tool', '{}'));
  assert.equal(result.role, 'tool');
  assert.equal(result.tool_call_id, 'nonexistent_tool');
  assert.match(result.content, /Unknown tool nonexistent_tool/);
  assert.equal(deps.toolsUsed.length, 1);
  assert.equal(deps.toolsUsed[0].success, false);
});

test('executeToolCall turns malformed argument JSON into a tool error', async () => {
  const deps = makeDeps();
  const result = await executeToolCall(deps, call('list_dir', '{not json'));
  assert.equal(result.role, 'tool');
  assert.match(result.content, /Invalid tool arguments JSON for list_dir/);
  assert.equal(deps.toolsUsed[0].success, false);
  // The result is recoverable — the model sees the error and can retry
  assert.equal(result.name, 'list_dir');
});

test('executeToolCall denies mutating calls during read-only phases', async () => {
  const deps = makeDeps({ readOnlyPhase: true });
  const denied = await executeToolCall(
    deps,
    call('write_file', JSON.stringify({ path: 'x.txt', content: 'data' }))
  );
  assert.match(denied.content, /Tool call denied/);
  assert.match(denied.content, /read-only/);
  assert.equal(deps.toolsUsed[0].success, false);
  // Read-only calls still pass through the same gate
  const allowed = await executeToolCall(deps, call('list_dir', JSON.stringify({ path: '.' }), 'ok'));
  assert.equal(deps.toolsUsed[1].success, true);
  assert.doesNotMatch(allowed.content, /Tool call denied/);
});

test('executeToolCall runs a real tool and records the success', async () => {
  mkdirSync(join(workspace, 'subdir'));
  writeFileSync(join(workspace, 'file.txt'), 'hi');
  const deps = makeDeps();
  const runs: string[] = [];
  deps.onToolRun = (name) => runs.push(name);
  const result = await executeToolCall(deps, call('list_dir', JSON.stringify({ path: '.' })));
  assert.equal(result.role, 'tool');
  assert.match(result.content, /\[DIR\] subdir/);
  assert.match(result.content, /\[FILE\] file.txt/);
  assert.equal(result.name, 'list_dir');
  assert.deepEqual(deps.toolsUsed.map(t => t.name), ['list_dir']);
  assert.equal(deps.toolsUsed[0].success, true);
  assert.deepEqual(runs, ['list_dir']);
});

test('executeToolCalls preserves call order in results', async () => {
  mkdirSync(join(workspace, 'a'));
  mkdirSync(join(workspace, 'b'));
  const deps = makeDeps();
  const results = await executeToolCalls(deps, [
    call('list_dir', JSON.stringify({ path: 'a' }), 'first'),
    call('list_dir', JSON.stringify({ path: 'b' }), 'second'),
    call('unknown_tool', '{}', 'third'),
  ]);
  assert.deepEqual(results.map(r => r.tool_call_id), ['first', 'second', 'third']);
  assert.match(results[2].content, /Unknown tool/);
});
