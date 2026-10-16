// CODEOWNERS drift guard (#501): GitHub applies CODEOWNERS silently — a dead
// pattern, a malformed owner, or a `*` rule placed after the specific ones all
// mean security-sensitive changes stop auto-requesting review with no visible
// error. These checks fail CI instead:
//
//   * .github/CODEOWNERS exists and every rule is a `pattern owner…` line —
//     comments and blank lines are the only other content
//   * a `*` default-owner rule exists and is the first rule — CODEOWNERS is
//     last-match-wins, so a `*` rule anywhere below would mask the specific
//     ownership rules that follow it
//   * each security-sensitive surface from the issue resolves to an explicit
//     (non-`*`) owner: run-shell, sandbox*, permissions*, path-security,
//     provider, dangerous-commands, src/mcp/, .github/workflows/
//   * every pattern matches at least one real path — a typo'd pattern
//     silently owns nothing
//   * owners are @handles / @org/teams / emails — and patterns avoid `!`/`[]`
//     syntax, which CODEOWNERS does not support

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, '..');
const CODEOWNERS_PATH = path.join(REPO_ROOT, '.github', 'CODEOWNERS');

// @user, @org/team, or a bare email address — the three owner forms GitHub
// accepts. Anything else (URLs, un-prefixed names) is ignored by GitHub.
const OWNER_RE = /^@[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9_.-]+)?$|^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Rule {
  pattern: string;
  owners: string[];
  line: number;
  regex: RegExp;
}

/** Parse CODEOWNERS into rules; asserts the file shape is valid. */
function parseRules(): Rule[] {
  const text = readFileSync(CODEOWNERS_PATH, 'utf-8');
  const rules: Rule[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [pattern, ...owners] = line.split(/\s+/);
    assert.ok(
      owners.length > 0,
      `CODEOWNERS line ${i + 1}: "${line}" has a pattern but no owner`
    );
    assert.ok(
      !/[![\]]/.test(pattern),
      `CODEOWNERS line ${i + 1}: pattern "${pattern}" uses ! or [] — unsupported by GitHub`
    );
    for (const owner of owners) {
      assert.match(
        owner,
        OWNER_RE,
        `CODEOWNERS line ${i + 1}: "${owner}" is not a valid @handle, @org/team or email`
      );
    }
    rules.push({ pattern, owners, line: i + 1, regex: patternToRegExp(pattern) });
  });
  return rules;
}

/**
 * Compile a CODEOWNERS pattern to a RegExp matching repo-relative paths.
 * Supports the subset this file uses: a leading `/` anchors to the repo root,
 * a trailing `/` means "everything under this directory", `*` matches within a
 * path segment, `**` spans segments, `?` matches one non-separator char.
 * Patterns without a `/` match basenames.
 */
function patternToRegExp(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  let src = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        src += '.*';
        i++;
        if (p[i + 1] === '/') i++; // `**/` also matches zero directories
      } else {
        src += '[^/]*';
      }
    } else if (c === '?') {
      src += '[^/]';
    } else {
      src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  if (anchored || p.includes('/')) {
    return dirOnly ? new RegExp(`^${src}/`) : new RegExp(`^${src}$`);
  }
  return new RegExp(`(^|/)${src}$`);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);

/** Repo-relative paths (`/`-separated) of every file GitHub could match on. */
function repoFiles(dir = REPO_ROOT, prefix = '', depth = 0, out: string[] = []): string[] {
  if (depth > 20) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      repoFiles(path.join(dir, entry.name), rel, depth + 1, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** The winning (last-matching) rule for a repo-relative path, or null. */
function ownerRuleFor(rules: Rule[], relPath: string): Rule | null {
  let winner: Rule | null = null;
  for (const rule of rules) {
    if (rule.regex.test(relPath)) winner = rule;
  }
  return winner;
}

// Representative real paths for each surface the issue calls out, plus the
// surfaces that can weaken the gates themselves.
const REQUIRED_SURFACES: Array<{ path: string; surface: string }> = [
  { path: 'src/tools/run-shell.ts', surface: 'shell execution' },
  { path: 'src/utils/sandbox.ts', surface: 'sandbox backend' },
  { path: 'src/utils/sandbox-proxy.ts', surface: 'sandbox egress proxy' },
  { path: 'src/utils/sandbox-seccomp.ts', surface: 'sandbox seccomp profile' },
  { path: 'src/utils/permissions.ts', surface: 'permission gate' },
  { path: 'src/utils/permissions-store.ts', surface: 'permission persistence' },
  { path: 'src/utils/path-security.ts', surface: 'path validation' },
  { path: 'src/utils/dangerous-commands.ts', surface: 'dangerous-command list' },
  { path: 'src/core/provider.ts', surface: 'provider wire protocol' },
  { path: 'src/mcp/client.ts', surface: 'src/mcp/ subtree' },
  { path: 'src/mcp/server-tools.ts', surface: 'src/mcp/ subtree' },
  { path: '.github/workflows/ci.yml', surface: 'CI workflows' },
  { path: '.github/workflows/security-scan.yml', surface: 'security workflows' },
  { path: '.github/CODEOWNERS', surface: 'CODEOWNERS itself' },
];

test('codeowners: .github/CODEOWNERS exists and parses into rules', () => {
  assert.ok(existsSync(CODEOWNERS_PATH), 'missing .github/CODEOWNERS');
  assert.ok(parseRules().length > 0, 'CODEOWNERS has no rules');
});

test('codeowners: a `*` default-owner rule exists and is the first rule', () => {
  const rules = parseRules();
  const star = rules.findIndex((r) => r.pattern === '*');
  assert.ok(star !== -1, 'CODEOWNERS has no default `*` owner rule');
  assert.equal(
    star,
    0,
    'the `*` default rule must be the first rule — last match wins, so a later `*` masks every specific rule above it'
  );
  assert.ok(rules[0].owners.length > 0, 'the `*` default rule has no owner');
});

test('codeowners: every security-sensitive surface resolves to an explicit owner', () => {
  const rules = parseRules();
  const files = new Set(repoFiles());
  for (const { path: relPath, surface } of REQUIRED_SURFACES) {
    assert.ok(files.has(relPath), `required surface ${relPath} does not exist in the repo`);
    const winner = ownerRuleFor(rules, relPath);
    assert.ok(winner, `${surface} (${relPath}) matches no CODEOWNERS rule`);
    assert.notEqual(
      winner!.pattern,
      '*',
      `${surface} (${relPath}) falls through to the default owner — it needs an explicit rule`
    );
    assert.ok(winner!.owners.length > 0, `${surface} (${relPath}) rule has no owner`);
  }
});

test('codeowners: every pattern matches at least one real path', () => {
  const files = repoFiles();
  for (const rule of parseRules()) {
    assert.ok(
      files.some((f) => rule.regex.test(f)),
      `CODEOWNERS line ${rule.line}: pattern "${rule.pattern}" matches nothing — dead rule`
    );
  }
});
