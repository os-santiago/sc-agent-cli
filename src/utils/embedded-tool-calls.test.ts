import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hasEmbeddedActionMarkup, recoverEmbeddedToolCalls } from './embedded-tool-calls.js';

// #533 — failure signature scc:zero-mutations:devin/swe-2-high: providers
// routing tag-structured models leak invocations into `content` as XML-ish
// markup instead of the structured tool_calls field; the run then ends with
// zero mutations and exits SCC_NO_CHANGES. These tests pin the families the
// agent recovers — and the prose it must leave alone.

test('hasEmbeddedActionMarkup recognizes every action markup family', () => {
  assert.equal(hasEmbeddedActionMarkup('<tool_call>{"name":"read_file"}</tool_call>'), true);
  assert.equal(hasEmbeddedActionMarkup('<invoke name="read_file"></invoke>'), true);
  assert.equal(hasEmbeddedActionMarkup('<ns:invoke name="read_file"></ns:invoke>'), true);
  assert.equal(hasEmbeddedActionMarkup('<function_calls><invoke name="x"/></function_calls>'), true);
  assert.equal(hasEmbeddedActionMarkup('<function=read_file>{}</function>'), true);
  assert.equal(hasEmbeddedActionMarkup('<function_call>{"name":"x"}</function_call>'), true);
});

test('hasEmbeddedActionMarkup ignores tag-structured prose and plain text', () => {
  // devin/swe-2-class gateways stream a summary envelope — it is a report,
  // not an invocation, and must flow through the normal turn-end path.
  assert.equal(hasEmbeddedActionMarkup('<summary>\n## Overview\nApplying the fix.\n</summary>'), false);
  assert.equal(hasEmbeddedActionMarkup('<details><summary>plan</summary>text</details>'), false);
  assert.equal(hasEmbeddedActionMarkup('<thinking>reasoning</thinking>'), false);
  assert.equal(hasEmbeddedActionMarkup('The fix has been applied.'), false);
  assert.equal(hasEmbeddedActionMarkup(''), false);
  assert.equal(hasEmbeddedActionMarkup(undefined), false);
});

test('recovers a JSON <tool_call> payload (the swe-2 failure shape)', () => {
  const content =
    '<summary>\n## Overview\nApplying the requested fix to parser.ts.\n</summary>\n' +
    '<tool_call>{"name":"write_file","arguments":{"path":"parser.ts","content":"patched"}}</tool_call>';
  const calls = recoverEmbeddedToolCalls(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'write_file');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'parser.ts', content: 'patched' });
  assert.equal(calls[0].type, 'function');
  assert.ok(calls[0].id.startsWith('embedded_'));
});

test('recovers <tool_call> with name attribute and args-object body', () => {
  const calls = recoverEmbeddedToolCalls('<tool_call name="read_file">{"path":"a.ts"}</tool_call>');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'a.ts' });
});

test('recovers <tool_call> with the tool name on the first line', () => {
  const calls = recoverEmbeddedToolCalls('<tool_call>\nrun_shell\n{"command":"ls -la"}\n</tool_call>');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'run_shell');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { command: 'ls -la' });
});

test('recovers parameters/args aliases and a name-only payload', () => {
  const aliased = recoverEmbeddedToolCalls('<tool_call>{"name":"search_text","parameters":{"pattern":"TODO"}}</tool_call>');
  assert.equal(aliased.length, 1);
  assert.equal(aliased[0].function.name, 'search_text');
  assert.deepEqual(JSON.parse(aliased[0].function.arguments), { pattern: 'TODO' });

  const bare = recoverEmbeddedToolCalls('<tool_call>{"name":"list_dir"}</tool_call>');
  assert.equal(bare.length, 1);
  assert.equal(bare[0].function.name, 'list_dir');
  assert.deepEqual(JSON.parse(bare[0].function.arguments), {});
});

test('recovers OpenAI wire shape and call envelopes inside <tool_call>', () => {
  const wire = recoverEmbeddedToolCalls(
    '<tool_call>{"id":"c1","function":{"name":"edit_file","arguments":{"path":"a","patch":"x"}}}</tool_call>'
  );
  assert.equal(wire.length, 1);
  assert.equal(wire[0].function.name, 'edit_file');

  const envelope = recoverEmbeddedToolCalls(
    '<tool_call>{"tool_calls":[{"name":"read_file","arguments":{"path":"a"}},{"name":"list_dir","arguments":{"path":"."}}]}</tool_call>'
  );
  assert.equal(envelope.length, 2);
  assert.equal(envelope[0].function.name, 'read_file');
  assert.equal(envelope[1].function.name, 'list_dir');
});

test('recovers multiple <tool_call> blocks in document order', () => {
  const calls = recoverEmbeddedToolCalls(
    '<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>' +
    ' then ' +
    '<tool_call>{"name":"write_file","arguments":{"path":"b","content":"x"}}</tool_call>'
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].function.name, 'read_file');
  assert.equal(calls[1].function.name, 'write_file');
});

test('recovers Anthropic-style <invoke> blocks with parameter children', () => {
  const content =
    '<function_calls>\n' +
    '<invoke name="read_file">\n<parameter name="path">src/a.ts</parameter>\n<parameter name="limit">10</parameter>\n</invoke>\n' +
    '</function_calls>';
  const calls = recoverEmbeddedToolCalls(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'src/a.ts', limit: '10' });
});

test('recovers namespaced invoke/parameter tags', () => {
  const calls = recoverEmbeddedToolCalls(
    '<ns:invoke name="write_file"><ns:parameter name="path">a.txt</ns:parameter></ns:invoke>'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'write_file');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'a.txt' });
});

test('recovers llama-style function tags', () => {
  const eq = recoverEmbeddedToolCalls('<function=run_shell>{"command":"ls"}</function>');
  assert.equal(eq.length, 1);
  assert.equal(eq[0].function.name, 'run_shell');
  assert.deepEqual(JSON.parse(eq[0].function.arguments), { command: 'ls' });

  const named = recoverEmbeddedToolCalls('<function name="list_dir">{"path":"."}</function>');
  assert.equal(named.length, 1);
  assert.equal(named[0].function.name, 'list_dir');

  const legacy = recoverEmbeddedToolCalls('<function_call>{"name":"git","arguments":{"operation":"status"}}</function_call>');
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].function.name, 'git');
  assert.deepEqual(JSON.parse(legacy[0].function.arguments), { operation: 'status' });
});

test('wraps non-JSON markup payloads as { input } args', () => {
  const calls = recoverEmbeddedToolCalls('<tool_call name="run_shell">ls -la</tool_call>');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'run_shell');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { input: 'ls -la' });
});

test('malformed markup recovers nothing so the agent re-prompts', () => {
  const content = '<tool_call>}{ not json and no usable name</tool_call>';
  assert.equal(hasEmbeddedActionMarkup(content), true);
  assert.equal(recoverEmbeddedToolCalls(content).length, 0);
});

test('structured prose reports produce no calls', () => {
  const content = '<summary>\n## Overview\nThe task is to implement coverage for src/tools/.\n</summary>';
  assert.equal(recoverEmbeddedToolCalls(content).length, 0);
  assert.equal(recoverEmbeddedToolCalls('The file has been updated.').length, 0);
  assert.equal(recoverEmbeddedToolCalls('').length, 0);
});
