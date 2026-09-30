#!/usr/bin/env node
/**
 * ensure-deps.mjs — self-heal missing devDependencies before npm scripts
 * that require them (`npm run build` → tsc, `npm test` → vitest).
 *
 * Fresh checkouts and quality gates that invoke npm scripts directly fail
 * with "sh: tsc: command not found" when `npm ci`/`npm install` has not run
 * yet. This hook checks for the required node_modules/.bin shims and, when
 * any are missing, installs the locked dependency tree once before the real
 * script runs. It is a no-op when dependencies are already installed.
 *
 * Usage: node scripts/ensure-deps.mjs <required .bin name> [...]
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bins = process.argv.slice(2);
const missing = bins.filter((name) => !existsSync(join(root, 'node_modules', '.bin', name)));
if (missing.length === 0) process.exit(0);

console.log(`[ensure-deps] missing ${missing.join(', ')} — running npm ci`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = ['ci', '--prefer-offline', '--no-audit', '--no-fund'];

let res = spawnSync(npm, args, { cwd: root, stdio: 'inherit' });
if (res.status !== 0) {
  // `npm ci` runs the `prepare` lifecycle script (husky), which needs a
  // working git dir — bare checkouts and sandboxes may not provide one.
  // Retry without lifecycle scripts so the dependencies still land.
  console.warn('[ensure-deps] npm ci failed — retrying with --ignore-scripts');
  res = spawnSync(npm, [...args, '--ignore-scripts'], { cwd: root, stdio: 'inherit' });
}
if (res.status !== 0) process.exit(res.status ?? 1);
