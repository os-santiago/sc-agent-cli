// Lint wiring drift guard (#490): eslint is configured (eslint.config.mjs)
// and husky + lint-staged are installed, but the setup only exists while
// every entry point stays connected. These tests fail CI on drift:
//
//   * package.json keeps a `lint` script that invokes eslint — the single
//     entry point CI and contributors share
//   * ci.yml runs `npm run lint` — a lint job exists even while it stays
//     advisory (`continue-on-error`) until the config cleanup lands
//   * lint-staged runs eslint on staged `*.ts` files — the pre-commit chain
//     .husky/pre-commit → lint-staged must not silently lose linting
//
// The eslint config itself and the pre-existing violation cleanup live in
// the companion issue — this guard watches the wiring, not the findings.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRootFile(name: string): string {
  return readFileSync(path.join(REPO_ROOT, name), 'utf-8');
}

test('lint wiring: package.json keeps an npm `lint` script that runs eslint', () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, 'eslint.config.mjs')),
    'eslint.config.mjs missing — the lint script has no config'
  );
  const pkg = JSON.parse(readRootFile('package.json'));
  assert.match(
    pkg.scripts?.lint ?? '',
    /\beslint\b/,
    'package.json must keep a `lint` script invoking eslint'
  );
});

test('lint wiring: ci.yml runs `npm run lint`', () => {
  const ci = readRootFile('.github/workflows/ci.yml');
  assert.match(
    ci,
    /npm run lint/,
    'ci.yml must keep an `npm run lint` step'
  );
});

test('lint wiring: the pre-commit chain runs eslint on staged *.ts', () => {
  // .husky/pre-commit → lint-staged → eslint — a break anywhere in the
  // chain silently turns staged-file linting off.
  assert.match(
    readRootFile('.husky/pre-commit'),
    /lint-staged/,
    '.husky/pre-commit must keep invoking lint-staged'
  );
  const pkg = JSON.parse(readRootFile('package.json'));
  const stagedCommands = [pkg['lint-staged']?.['*.ts'] ?? []].flat();
  assert.ok(
    stagedCommands.some((cmd) => /\beslint\b/.test(cmd)),
    'lint-staged "*.ts" must keep an eslint command — vitest alone is not linting'
  );
});
