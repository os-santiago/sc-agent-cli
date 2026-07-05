import { test } from 'vitest';
import assert from 'node:assert/strict';
import { pruneMessageHistory, limitMessageHistory } from './agent.js';
import type { Message } from './types.js';

test('pruneMessageHistory keeps recent tool messages fully intact and truncates old ones', () => {
  const messages: Message[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'hello' },
    { role: 'tool', content: 'a'.repeat(2000), tool_call_id: '1' }, // old, should be truncated
    { role: 'tool', content: 'b'.repeat(2000), tool_call_id: '2' }, // old, should be truncated
    ...Array.from({ length: 10 }, (_, i) => ({
      role: 'tool' as const,
      content: 'recent_' + i,
      tool_call_id: `recent_${i}`,
    })),
  ];

  const pruned = pruneMessageHistory(messages, 10, 1000);
  
  // The first two tool messages should be truncated
  assert.match(pruned[2].content, /truncated to save context window/);
  assert.match(pruned[3].content, /truncated to save context window/);
  
  // The recent 10 tool messages should remain fully intact
  for (let i = 0; i < 10; i++) {
    assert.equal(pruned[4 + i].content, 'recent_' + i);
  }
});

test('limitMessageHistory preserves system message and slices at safe points', () => {
  // Scenario 1: Slicing on an assistant message (within a tool chain)
  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'original user prompt' },
    { role: 'assistant', content: 'thought 1' },
    { role: 'tool', content: 'tool result 1', tool_call_id: 't1' },
    { role: 'assistant', content: 'thought 2' },
    { role: 'tool', content: 'tool result 2', tool_call_id: 't2' },
    { role: 'assistant', content: 'thought 3' },
    { role: 'tool', content: 'tool result 3', tool_call_id: 't3' },
  ];

  // We want to limit history to 4 messages
  const limited = limitMessageHistory(messages, 4);

  assert.equal(limited.length, 6);
  assert.equal(limited[0].role, 'system');
  assert.equal(limited[1].role, 'user');
  assert.equal(limited[1].content, 'original user prompt');
  assert.equal(limited[2].role, 'assistant');
  assert.equal(limited[2].content, 'thought 2');
});

test('limitMessageHistory slices safely when targetStartIndex lands on a tool response', () => {
  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'original prompt' },
    { role: 'assistant', content: 'thought 1' },
    { role: 'tool', content: 'tool result 1', tool_call_id: 't1' },
    { role: 'assistant', content: 'thought 2' },
    { role: 'tool', content: 'tool result 2', tool_call_id: 't2' },
  ];

  const limited = limitMessageHistory(messages, 3);

  assert.equal(limited.length, 6);
  assert.equal(limited[0].role, 'system');
  assert.equal(limited[1].content, 'original prompt');
  assert.equal(limited[2].content, 'thought 1');
});
