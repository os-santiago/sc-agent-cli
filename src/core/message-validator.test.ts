import { test, vi, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  MALFORMED_TOOL_ARGS_MARKER,
  MessageValidationError,
  validateMessageSequence,
  autoCorrectMessageSequence,
  isMessageSequenceValid,
  isValidToolArguments,
  sanitizeToolCallArguments,
} from './message-validator.js';
import type { Message, ToolCall } from './types.js';

// Locks the current repair contract (#482): the validator throws on hard
// errors (orphaned tool_result, duplicate tool_call_id, misplaced system
// messages, tool results with the wrong role), warns — but does not throw —
// on dangling tool_use, and autoCorrect only repairs assistant-role tool
// results before re-validating.

afterEach(() => {
  vi.restoreAllMocks();
});

function toolCall(id: string, name = 'read_file'): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

function assistantWithCall(id: string, name = 'read_file'): Message {
  return { role: 'assistant', content: '', tool_calls: [toolCall(id, name)] };
}

function toolResult(id: string, content = 'ok'): Message {
  return { role: 'tool', tool_call_id: id, content };
}

test('a well-formed conversation validates without warnings', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    assistantWithCall('c1'),
    toolResult('c1'),
    { role: 'assistant', content: 'done' },
  ];
  assert.doesNotThrow(() => validateMessageSequence(messages));
  assert.equal(warn.mock.calls.length, 0);
});

test('multiple leading system messages are allowed', () => {
  const messages: Message[] = [
    { role: 'system', content: 'a' },
    { role: 'system', content: 'b' },
    { role: 'user', content: 'hi' },
  ];
  assert.doesNotThrow(() => validateMessageSequence(messages));
});

test('orphaned tool_result (result without matching call) throws', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hi' },
    toolResult('orphan-id'),
  ];
  assert.throws(
    () => validateMessageSequence(messages),
    (err: unknown) => {
      assert.ok(err instanceof MessageValidationError);
      const e = err as MessageValidationError;
      assert.equal(e.messageIndex, 1);
      assert.equal(e.invalidMessage, messages[1]);
      assert.match(e.message, /unknown tool_call_id 'orphan-id'/);
      assert.equal(e.name, 'MessageValidationError');
      return true;
    }
  );
});

test('tool result with a role other than tool throws (OpenAI spec violation)', () => {
  for (const role of ['user', 'system'] as const) {
    const messages: Message[] = [{ role, tool_call_id: 'c1', content: 'x' }];
    assert.throws(
      () => validateMessageSequence(messages),
      (err: unknown) => {
        assert.ok(err instanceof MessageValidationError);
        assert.match((err as Error).message, new RegExp(`role:'tool', not role:'${role}'`));
        return true;
      }
    );
  }
});

test('autoCorrectMessageSequence rewrites assistant-role tool results to role tool', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const messages: Message[] = [
    assistantWithCall('c1'),
    { role: 'assistant', tool_call_id: 'c1', content: 'file contents' },
  ];

  const corrected = autoCorrectMessageSequence(messages);
  assert.equal(corrected.length, 2);
  assert.equal(corrected[1].role, 'tool');
  assert.equal(corrected[1].tool_call_id, 'c1');
  assert.equal(corrected[1].content, 'file contents');
  assert.match(warn.mock.calls.map((c) => String(c[0])).join('\n'), /Auto-correcting/);
});

test('autoCorrect still throws on an orphaned assistant-role tool result', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const messages: Message[] = [{ role: 'assistant', tool_call_id: 'gone', content: 'x' }];
  assert.throws(() => autoCorrectMessageSequence(messages), MessageValidationError);
});

test('dangling tool_use (call without result) warns but does not throw', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const messages: Message[] = [
    { role: 'user', content: 'hi' },
    assistantWithCall('c1', 'run_shell'),
    assistantWithCall('c2', 'read_file'),
  ];
  assert.doesNotThrow(() => validateMessageSequence(messages));
  const out = warn.mock.calls.map((c) => String(c[0])).join('\n');
  assert.match(out, /2 tool calls without results/);
  assert.match(out, /run_shell \(index 1\)/);
  assert.match(out, /read_file \(index 2\)/);
});

test('duplicate tool_call_id across assistant messages throws', () => {
  const messages: Message[] = [
    assistantWithCall('dup'),
    assistantWithCall('dup'),
  ];
  assert.throws(
    () => validateMessageSequence(messages),
    /Duplicate tool_call_id 'dup'/
  );
});

test('a resolved tool_call_id can be re-issued — it re-registers as pending', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const messages: Message[] = [
    assistantWithCall('c1'),
    toolResult('c1'),
    assistantWithCall('c1'),
  ];
  // The result consumed the pending entry, so the second call registers
  // cleanly — it is only flagged because it never gets a result itself.
  assert.doesNotThrow(() => validateMessageSequence(messages));
  assert.match(warn.mock.calls.map((c) => String(c[0])).join('\n'), /1 tool calls? without results/);
});

test('system message after non-system messages throws', () => {
  const messages: Message[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    { role: 'system', content: 'late sys' },
  ];
  assert.throws(
    () => validateMessageSequence(messages),
    (err: unknown) => {
      assert.ok(err instanceof MessageValidationError);
      assert.equal((err as MessageValidationError).messageIndex, 2);
      assert.match((err as Error).message, /System message found after non-system/);
      return true;
    }
  );
});

test('isMessageSequenceValid returns true for valid and warn-only sequences', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  assert.equal(isMessageSequenceValid([{ role: 'user', content: 'hi' }]), true);
  // Dangling tool_use is a warning, not an error — the sequence is "valid".
  assert.equal(isMessageSequenceValid([assistantWithCall('c1')]), true);
});

test('isMessageSequenceValid returns false for invalid sequences without throwing', () => {
  assert.equal(
    isMessageSequenceValid([{ role: 'user', content: 'hi', tool_call_id: 'x' }]),
    false
  );
  assert.equal(isMessageSequenceValid([toolResult('nope')]), false);
});

test('a tool result that arrives before its call is still orphaned', () => {
  const messages: Message[] = [
    toolResult('c1'),
    assistantWithCall('c1'),
  ];
  assert.throws(() => validateMessageSequence(messages), /unknown tool_call_id/);
  assert.throws(() => autoCorrectMessageSequence(messages), MessageValidationError);
});

test('autoCorrectMessageSequence passes a valid sequence through unchanged', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hi' },
    assistantWithCall('c1'),
    toolResult('c1'),
    { role: 'assistant', content: 'done' },
  ];
  const corrected = autoCorrectMessageSequence(messages);
  assert.deepEqual(corrected, messages);
});

// --- Malformed tool-call arguments repair (#537) ---------------------------
// A model-emitted call whose `function.arguments` is not a valid JSON object
// string must never sit in history verbatim: providers that validate
// tool_calls on every request answer a deterministic 400 that recurs with
// the same context. The history/wire copy is repaired to a placeholder.

test('isValidToolArguments requires a JSON string decoding to a plain object', () => {
  assert.equal(isValidToolArguments('{"path":"a.ts"}'), true);
  assert.equal(isValidToolArguments(' {} '), true);
  // Valid JSON but not an object — providers demand an object string.
  for (const bad of ['[1,2]', '"x"', '42', 'null', '{"a":1', '', 'not json', 123, null, undefined, ['a']]) {
    assert.equal(isValidToolArguments(bad), false, String(bad));
  }
});

test('sanitizeToolCallArguments returns the same reference for valid args', () => {
  const call = toolCall('c1');
  assert.equal(sanitizeToolCallArguments(call), call);
});

test('sanitizeToolCallArguments replaces malformed args with a marked placeholder', () => {
  const call = toolCall('c1', 'edit_file');
  call.function.arguments = `{"patch": "bad${String.fromCharCode(31)}escape"}`; // invalid control char

  const fixed = sanitizeToolCallArguments(call);
  assert.notEqual(fixed, call);
  assert.equal(fixed.id, 'c1');
  assert.equal(fixed.function.name, 'edit_file');

  // The repaired arguments are themselves a valid JSON object string.
  const parsed = JSON.parse(fixed.function.arguments);
  assert.equal(typeof parsed, 'object');
  assert.ok(MALFORMED_TOOL_ARGS_MARKER in parsed);
  assert.match(parsed[MALFORMED_TOOL_ARGS_MARKER], /bad/);
  assert.equal(isValidToolArguments(fixed.function.arguments), true);
});

test('sanitizeToolCallArguments bounds the preserved raw preview', () => {
  const call = toolCall('c1');
  call.function.arguments = `{"x": "${'y'.repeat(5000)}` ;
  const fixed = sanitizeToolCallArguments(call);
  const parsed = JSON.parse(fixed.function.arguments);
  assert.ok(parsed[MALFORMED_TOOL_ARGS_MARKER].length <= 400);
});

test('sanitizeToolCallArguments re-serializes object-typed arguments losslessly', () => {
  const call = toolCall('c1');
  // Some OpenAI-compatible providers emit arguments pre-parsed.
  (call.function as { arguments: unknown }).arguments = { path: 'a.ts', offset: 2 };
  const fixed = sanitizeToolCallArguments(call);
  assert.equal(fixed.function.arguments, '{"path":"a.ts","offset":2}');
  assert.equal(isValidToolArguments(fixed.function.arguments), true);
});

test('autoCorrectMessageSequence repairs malformed tool-call args in history', () => {
  const bad = assistantWithCall('c1', 'write_file');
  bad.tool_calls![0].function.arguments = '{"content": "unterminated';
  const good = assistantWithCall('c2', 'read_file');
  const messages: Message[] = [{ role: 'user', content: 'hi' }, bad, toolResult('c1'), good, toolResult('c2')];

  const corrected = autoCorrectMessageSequence(messages);

  const repaired = corrected[1].tool_calls![0].function.arguments;
  assert.ok(isValidToolArguments(repaired));
  assert.match(repaired, new RegExp(MALFORMED_TOOL_ARGS_MARKER));
  // Valid calls pass through untouched.
  assert.equal(corrected[3].tool_calls![0].function.arguments, '{}');
});
