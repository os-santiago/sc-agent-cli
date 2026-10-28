// Docs link-sweep guard (#597): cross-references in the markdown docs drift
// silently — a renamed or removed page leaves dead `](relative/path.md)` links
// that nobody notices until a reader clicks them. These checks fail CI instead:
//
//   * docs/README.md exists and links every other page under docs/ — the index
//     is the verified anchor new links can point at
//   * every relative markdown link in docs/*.md, the root *.md, and the
//     .github/ markdown (PR + issue templates) resolves to a real file
//     (external URLs and pure `#anchor` links are ignored, and fenced code
//     blocks are skipped so shell snippets don't produce false positives)
//   * the specific drift the issue reported stays fixed — no `permissions.md`
//     or `error-handling.md` link survives; they point at
//     docs/permission-profiles.md and docs/loop-detection.md respectively

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const GITHUB_DIR = path.join(REPO_ROOT, '.github');
const INDEX_PATH = path.join(DOCS_DIR, 'README.md');

/** Every *.md file directly inside `dir` (non-recursive), as absolute paths. */
function markdownIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(dir, name));
}

/**
 * Absolute paths of every markdown doc we sweep: docs/*.md, root *.md, and the
 * .github/ markdown (PR + issue templates live there and link into the repo).
 */
function docFiles(): string[] {
  const files = [...markdownIn(DOCS_DIR), ...markdownIn(REPO_ROOT)];
  if (existsSync(GITHUB_DIR)) files.push(...markdownIn(GITHUB_DIR));
  return files;
}

/** Inline markdown link/image targets, ignoring fenced code blocks. */
function linkTargets(text: string): string[] {
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const targets: string[] = [];
  for (const m of stripped.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    targets.push(m[1]);
  }
  return targets;
}

/** True for links we don't resolve locally (http(s), mailto, #anchor). */
function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#');
}

/** docs/ pages excluding the index itself. */
function indexedDocs(): string[] {
  return readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();
}

test('docs links: docs/README.md index exists', () => {
  assert.ok(existsSync(INDEX_PATH), 'missing docs/README.md — the docs index');
});

test('docs links: the index links every page under docs/', () => {
  const index = readFileSync(INDEX_PATH, 'utf-8');
  const linked = new Set(
    linkTargets(index)
      .filter((t) => !isExternal(t))
      .map((t) => path.resolve(DOCS_DIR, t.split('#')[0]))
  );
  const missing = indexedDocs()
    .map((name) => path.join(DOCS_DIR, name))
    .filter((abs) => !linked.has(abs))
    .map((abs) => path.relative(REPO_ROOT, abs));
  assert.deepEqual(
    missing,
    [],
    `docs/README.md does not link these pages — add them so every doc has a verified anchor`
  );
});

test('docs links: every relative markdown link resolves to a real file', () => {
  const broken: string[] = [];
  for (const file of docFiles()) {
    const text = readFileSync(file, 'utf-8');
    for (const target of linkTargets(text)) {
      if (isExternal(target)) continue;
      const rel = target.split('#')[0];
      if (!rel) continue;
      const resolved = path.resolve(path.dirname(file), rel);
      if (!existsSync(resolved)) {
        broken.push(`${path.relative(REPO_ROOT, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(
    broken.sort(),
    [],
    `markdown links point at files that do not exist — fix the link or restore the target`
  );
});

test('docs links: the reported permissions.md / error-handling.md drift stays fixed', () => {
  const offenders: string[] = [];
  for (const file of docFiles()) {
    const text = readFileSync(file, 'utf-8');
    for (const target of linkTargets(text)) {
      if (/(^|\/)(permissions|error-handling)\.md$/.test(target.split('#')[0])) {
        offenders.push(`${path.relative(REPO_ROOT, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    'links still point at the non-existent permissions.md / error-handling.md — use docs/permission-profiles.md and docs/loop-detection.md'
  );
});
