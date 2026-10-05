import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requiredBins = ['tsc', 'vitest'];
const missing = requiredBins.filter(
  (bin) => !existsSync(join(root, 'node_modules', '.bin', bin))
);

if (missing.length === 0) {
  process.exit(0);
}

console.log(`Missing dev dependencies (${missing.join(', ')}). Running npm ci...`);

const result = spawnSync('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`Failed to run npm ci: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
