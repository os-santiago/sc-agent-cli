// PR-title workflow drift guard (#491): `.github/workflows/pr-title.yml`
// enforces conventional-commit PR titles so squash-merged main-line commits
// stay parseable for release automation. GitHub surfaces a broken workflow
// only as a silently-missing check — these assertions fail CI instead:
//
//   * the workflow exists and triggers on `pull_request_target` with the
//     `edited` type (a title rename must re-run the check)
//   * it uses amannn/action-semantic-pull-request pinned to a full-length
//     commit SHA (tags are re-pointable; a SHA is the supply-chain contract)
//   * it never checks out the PR — `pull_request_target` runs with base-repo
//     trust, so building PR code here would be a privilege-escalation hole
//   * the configured `types:` list covers the Conventional Commits set plus
//     `security` (repo convention, e.g. the #469–#478 security fixes)
//   * permissions stay minimal (`pull-requests: read`) and the token is wired
//   * CONTRIBUTING.md documents the check (issue acceptance criterion)

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'pr-title.yml');
const CONTRIBUTING_PATH = path.join(REPO_ROOT, 'CONTRIBUTING.md');

const EXPECTED_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
  'security',
] as const;

function readWorkflow(): string {
  assert.ok(existsSync(WORKFLOW_PATH), 'missing .github/workflows/pr-title.yml');
  return readFileSync(WORKFLOW_PATH, 'utf-8');
}

test('pr-title workflow: triggers on pull_request_target with opened/edited/reopened', () => {
  const yaml = readWorkflow();
  assert.ok(!yaml.includes('\t'), 'workflow contains a tab — YAML forbids tab indentation');
  assert.match(yaml, /^on:\s*$/m, 'workflow missing top-level "on:"');
  assert.match(
    yaml,
    /^\s+pull_request_target:\s*$/m,
    'must trigger on pull_request_target so fork PRs are covered and the check config comes from the base branch'
  );
  for (const type of ['opened', 'edited', 'reopened']) {
    assert.match(
      yaml,
      new RegExp(`types:\\s*\\[[^\\]]*\\b${type}\\b`),
      `pull_request_target types must include "${type}" — without "edited" a title rename never revalidates`
    );
  }
});

test('pr-title workflow: action is pinned to a full-length commit SHA', () => {
  const yaml = readWorkflow();
  const uses = yaml.match(/uses:\s*amannn\/action-semantic-pull-request@(\S+)/);
  assert.ok(uses, 'workflow must use amannn/action-semantic-pull-request');
  assert.match(
    uses[1],
    /^[0-9a-f]{40}$/,
    `action ref "${uses[1]}" must be a 40-char commit SHA, not a mutable tag`
  );
});

test('pr-title workflow: never checks out code under pull_request_target', () => {
  const yaml = readWorkflow();
  assert.ok(
    !/uses:\s*actions\/checkout/.test(yaml),
    'checkout under pull_request_target would run the merge-result tree with base-repo trust — the check only needs the event payload title'
  );
});

test('pr-title workflow: minimal permissions and token wired to the action', () => {
  const yaml = readWorkflow();
  assert.match(yaml, /^permissions:\s*$/m, 'workflow must declare an explicit permissions block');
  assert.match(
    yaml,
    /pull-requests:\s*read/,
    'the action only needs pull-requests: read — do not widen'
  );
  assert.doesNotMatch(
    yaml,
    /:\s*write\b/,
    'no *: write permission — a metadata-only title check must stay read-only'
  );
  assert.match(yaml, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/, 'GITHUB_TOKEN env must reach the action');
});

test('pr-title workflow: types list covers conventional commits plus security', () => {
  const yaml = readWorkflow();
  const header = yaml.match(/^([ ]+)types:\s*\|\s*$/m);
  assert.ok(header, 'missing "types: |" block under the action\'s "with:"');
  // A YAML literal block runs until the first non-empty line that dedents to
  // the `types:` key's indentation or less.
  const baseIndent = header[1];
  const entries: string[] = [];
  for (const line of yaml.slice(header.index! + header[0].length).split('\n')) {
    if (line.trim() === '') continue;
    if (!line.startsWith(`${baseIndent} `)) break;
    entries.push(line.trim());
  }
  for (const type of EXPECTED_TYPES) {
    assert.ok(entries.includes(type), `types list missing "${type}"`);
  }
});

test('pr-title check is documented in CONTRIBUTING.md', () => {
  const md = readFileSync(CONTRIBUTING_PATH, 'utf-8');
  assert.match(md, /pr-title\.yml/, 'CONTRIBUTING.md must name the pr-title.yml check');
  assert.match(
    md,
    /Conventional Commits/i,
    'CONTRIBUTING.md must reference the Conventional Commits convention the check enforces'
  );
});
