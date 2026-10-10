// Security workflow regression guard (#535): .github/workflows/security-scan.yml
// used to pass `base: main`/`head: HEAD` to trufflesecurity/trufflehog. Those
// refs resolve to the same commit on `push` (to main) and `schedule` runs, so
// the action exited 1 with "BASE and HEAD commits are the same" on every main
// push and daily cron — a permanently red gate teaches everyone to ignore it.
// These checks fail CI instead:
//
//   * the TruffleHog step must not set `base:`/`head:` inputs — with no
//     explicit range the action derives one per event type (push:
//     before..after, falling back to full history when `before` is the zero
//     SHA; pull_request: base.sha..head.sha; schedule/workflow_dispatch: the
//     full repository)
//   * `workflow_dispatch` stays registered so the scan can be verified on
//     demand without waiting for the daily cron
//   * the secret-scan checkout keeps `fetch-depth: 0` (full history is what
//     makes range and whole-repo scans possible)
//   * the action ref stays pinned to a 40-char commit SHA, not a mutable
//     branch like `@main`
//   * `--only-verified` stays in extra_args — verified-secret findings are
//     what fail the job
//   * pr-security-checks.yml's dependency-review step keeps its per-dependency
//     license exemption for TruffleHog: the pinned action is AGPL-3.0, which
//     the deny-licenses gate rejects even though the scanner is CI-only and
//     never ships. Losing the exemption re-fails Dependency Review on the
//     next PR that touches the workflow.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.resolve(SRC_DIR, '..', '.github', 'workflows', 'security-scan.yml');
const PR_CHECKS_PATH = path.resolve(SRC_DIR, '..', '.github', 'workflows', 'pr-security-checks.yml');

function workflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf-8');
}

/** The `on:` mapping — from the `on:` key to the next top-level key. */
function onBlock(yaml: string): string {
  const start = /^on:/m.exec(yaml);
  const end = /^permissions:/m.exec(yaml);
  assert.ok(start && end && end.index > start.index, 'security-scan.yml missing on:/permissions: blocks');
  return yaml.slice(start.index, end.index);
}

/** The `secret-scan` job block — from `  secret-scan:` to the next job key. */
function secretScanJob(yaml: string): string {
  const start = /^  secret-scan:\s*$/m.exec(yaml);
  assert.ok(start, 'security-scan.yml missing the secret-scan job');
  const nextJob = /^  \w[\w-]*:\s*$/gm;
  nextJob.lastIndex = start.index + 1;
  const end = nextJob.exec(yaml);
  return yaml.slice(start.index, end ? end.index : yaml.length);
}

/** Split a block into per-step chunks on `- name:` boundaries. */
function stepChunks(block: string): string[] {
  const matches = [...block.matchAll(/^\s+-\s+name:/gm)];
  return matches.map((m, i) =>
    block.slice(m.index!, i + 1 < matches.length ? matches[i + 1].index! : block.length)
  );
}

function trufflehogStep(yaml: string): string {
  const step = stepChunks(secretScanJob(yaml)).find((chunk) => chunk.includes('trufflesecurity/trufflehog'));
  assert.ok(step, 'security-scan.yml has no trufflesecurity/trufflehog step');
  return step;
}

test('security-scan: workflow exists, is tab-free and keeps push/PR/schedule/dispatch triggers', () => {
  assert.ok(existsSync(WORKFLOW_PATH), 'missing .github/workflows/security-scan.yml');
  const yaml = workflow();
  assert.ok(!yaml.includes('\t'), 'security-scan.yml contains a tab — YAML forbids tab indentation');

  const on = onBlock(yaml);
  for (const trigger of ['push:', 'pull_request:', 'schedule:', 'workflow_dispatch:']) {
    assert.match(
      on,
      new RegExp(`^  ${trigger}\\s*$`, 'm'),
      `security-scan.yml on: missing the "${trigger.slice(0, -1)}" trigger`
    );
  }
});

test('security-scan: TruffleHog step declares no explicit base/head refs', () => {
  const step = trufflehogStep(workflow());
  for (const input of ['base', 'head']) {
    assert.ok(
      !new RegExp(`^\\s+${input}:`, 'm').test(step),
      `TruffleHog step sets \`${input}:\` — fixed refs resolve to the same commit on push/schedule, reintroducing the base==head failure (#535)`
    );
  }
});

test('security-scan: TruffleHog stays SHA-pinned and verified-only', () => {
  const step = trufflehogStep(workflow());
  assert.match(
    step,
    /uses:\s*trufflesecurity\/trufflehog@[0-9a-f]{40}\b/,
    'TruffleHog must be pinned to a full commit SHA — a mutable @main ref can drift back into the broken config'
  );
  assert.match(step, /--only-verified/, 'TruffleHog step must keep --only-verified reporting semantics');
});

test('security-scan: dependency review exempts CI-only TruffleHog without weakening the license gate', () => {
  const yaml = readFileSync(PR_CHECKS_PATH, 'utf-8');
  const step = stepChunks(yaml).find((chunk) => chunk.includes('actions/dependency-review-action'));
  assert.ok(step, 'pr-security-checks.yml has no actions/dependency-review-action step');

  // The policy itself must stay: AGPL remains denied for everything else —
  // the exemption is per-dependency, not a removal of the license gate.
  assert.match(step, /deny-licenses:[^\n]*AGPL-3\.0/, 'dependency-review must keep denying AGPL-3.0');

  // The exemption must name the same action the workflow pins. Matching is
  // version-less in the action, so the purl covers future SHA re-pins.
  assert.match(
    trufflehogStep(workflow()),
    /uses:\s*trufflesecurity\/trufflehog@[0-9a-f]{40}\b/,
    'exemption presumes the SHA-pinned TruffleHog action — re-check it if the scanner changes'
  );
  assert.match(
    step,
    /allow-dependencies-licenses:[^\n]*pkg:githubactions\/trufflesecurity\/trufflehog\b/,
    'dependency-review must exempt pkg:githubactions/trufflesecurity/trufflehog — the AGPL-3.0 CI scanner otherwise fails the license gate'
  );
});

test('security-scan: secret-scan checkout keeps fetch-depth: 0', () => {
  assert.match(
    secretScanJob(workflow()),
    /fetch-depth:\s*0/,
    'secret-scan checkout needs fetch-depth: 0 — push ranges and full-history scans require the full clone'
  );
});
