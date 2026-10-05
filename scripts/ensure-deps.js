#!/usr/bin/env node
// Ensures dev dependencies are installed before npm scripts that rely on
// local binaries (tsc, vitest). Runs `npm ci` only when the binaries are
// missing, so it is a no-op on a healthy checkout.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = process.platform === 'win32' ? '.cmd' : '';
const missing = ['tsc', 'vitest'].filter(
  (bin) => !existsSync(join(root, 'node_modules', '.bin', bin + ext)),
);

if (missing.length > 0) {
  console.log(`Missing dev dependencies (${missing.join(', ')}). Running npm ci...`);
  const result = spawnSync('npm', ['ci', '--include=dev'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`Failed to run npm ci: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
