import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  compressOldMessages,
  compressToolResult,
  redactToolCall,
  MAX_TOOL_RESULT_CHARS,
  TOOL_RESULT_SYNTHESIS_NUDGE,
} from './message-history.js';
import type { Message, ToolCall } from '../types.js';

test('compressOldMessages leaves short histories untouched', () => {
  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ];
  assert.equal(compressOldMessages(messages, 30, 300), messages);
});

test('compressOldMessages compresses old tool outputs and keeps recent ones intact', () => {
  const big = 'x'.repeat(500);
  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'prompt' },
    // Old tool message — beyond the recent window, should be compressed
    { role: 'tool', content: big, tool_call_id: 'old' },
    // Recent window: 8 messages (keepRecentCount=4 keeps last 8 non-system)
    ...Array.from({ length: 8 }, (_, i) => ({
      role: 'user' as const,
      content: `recent-${i}`,
    })),
  ];

  const compressed = compressOldMessages(messages, 4, 300);
  // System stays first
  assert.equal(compressed[0].role, 'system');
  // The old tool output was compressed to maxToolLength + notice
  const oldTool = compressed.find(m => m.role === 'tool')!;
  assert.match(oldTool.content, /Tool output compressed: 500 chars → 300 chars/);
  assert.equal(oldTool.content.startsWith('x'.repeat(300)), true);
  // Recent messages preserved verbatim
  assert.equal(compressed[compressed.length - 1].content, 'recent-7');
});

test('compressToolResult keeps outputs under the limit untouched', () => {
  const small = 'a'.repeat(MAX_TOOL_RESULT_CHARS);
  assert.equal(compressToolResult(small), small);
});

test('compressToolResult truncates giant outputs with head + tail and a notice', () => {
  const content = 'H'.repeat(5000) + 'M'.repeat(5000) + 'T'.repeat(3000);
  const out = compressToolResult(content);
  assert.equal(out.length < content.length, true);
  assert.match(out, /Tool output compressed: 13000 chars → 8000 chars/);
  assert.equal(out.startsWith('H'.repeat(5000)), true);
  assert.equal(out.endsWith('T'.repeat(3000)), true);
});

test('TOOL_RESULT_SYNTHESIS_NUDGE is the synthesis instruction appended to tool results', () => {
  assert.match(TOOL_RESULT_SYNTHESIS_NUDGE, /Analyze the tool results above/);
  assert.match(TOOL_RESULT_SYNTHESIS_NUDGE, /summarize the results/i);
});

test('redactToolCall masks secrets in arguments but preserves identity fields', () => {
  const call: ToolCall = {
    id: 'call-1',
    type: 'function',
    function: {
      name: 'write_file',
      arguments: JSON.stringify({ path: 'x.ts', content: 'token: sc-fake-secret-value-123' }),
    },
  };
  const redacted = redactToolCall(call);
  // Original untouched (response.tool_calls must execute verbatim)
  assert.equal(call.function.arguments.includes('sc-fake-secret-value-123'), true);
  assert.equal(redacted.id, 'call-1');
  assert.equal(redacted.function.name, 'write_file');
  // The copied arguments may be masked — never equal the raw secret payload
  assert.notEqual(redacted.function.arguments, call.function.arguments);
});
