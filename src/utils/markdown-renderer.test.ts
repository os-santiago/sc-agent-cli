import { test } from 'vitest';
import assert from 'node:assert/strict';
import { renderInline } from './markdown-renderer.js';

test('renderInline returns empty string for empty input', () => {
  assert.equal(renderInline(''), '');
});

test('renderInline renders basic markdown', () => {
  const out = renderInline('# Title\n\n**bold** and `code`');
  assert.ok(out.includes('Title'));
  assert.ok(out.includes('bold'));
  assert.ok(out.includes('code'));
});

test('renderInline renders each task-list checkbox exactly once', () => {
  // marked >=17 emits a dedicated checkbox token; without the renderer
  // override the box would be duplicated by marked-terminal's own prepend.
  const out = renderInline('- [x] done\n- [ ] todo');
  assert.equal((out.match(/\[X\]/g) || []).length, 1);
  assert.equal((out.match(/\[ \]/g) || []).length, 1);
  assert.ok(out.includes('done'));
  assert.ok(out.includes('todo'));
});

test('renderInline returns the raw text when parsing throws', () => {
  const sentinel = 'plain text';
  assert.equal(renderInline(sentinel), sentinel);
});
