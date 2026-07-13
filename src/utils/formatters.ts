import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export interface FormatterResult {
  command: string;
  ran: boolean;
  output: string;
  modified: boolean;
}

const DETECTION_RULES: Array<{
  file: string;
  command: string;
}> = [
  { file: 'package.json', command: 'npx prettier --write' },
  { file: '.prettierrc', command: 'npx prettier --write' },
  { file: '.prettierrc.json', command: 'npx prettier --write' },
  { file: 'pom.xml', command: 'mvn spotless:apply' },
  { file: '.clang-format', command: 'clang-format -i' },
  { file: 'go.mod', command: 'gofmt -w' },
  { file: 'Cargo.toml', command: 'cargo fmt' },
  { file: 'pyproject.toml', command: 'ruff format' },
  { file: 'setup.cfg', command: 'ruff format' },
  { file: 'rustfmt.toml', command: 'cargo fmt' },
];

export async function detectFormatters(workspaceRoot: string): Promise<string[]> {
  const found: string[] = [];

  for (const rule of DETECTION_RULES) {
    const rulePath = path.join(workspaceRoot, rule.file);
    try {
      await access(rulePath, constants.F_OK);
      if (!found.includes(rule.command)) {
        found.push(rule.command);
      }
    } catch {
      // file not found, skip
    }
  }

  return found;
}

export function runFormatter(command: string, workspaceRoot: string): FormatterResult {
  const parts = command.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  const before = spawnSync('git', ['diff', '--stat'], {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 60000,
  }).stdout || '';

  const result = spawnSync(cmd, args, {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    return {
      command,
      ran: true,
      output: `Failed: ${result.error.message}`,
      modified: false,
    };
  }

  const after = spawnSync('git', ['diff', '--stat'], {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 30000,
  }).stdout || '';

  const outputLines: string[] = [];
  if (result.stdout?.trim()) outputLines.push(result.stdout.trim());
  if (result.stderr?.trim()) outputLines.push(result.stderr.trim());

  return {
    command,
    ran: result.status === 0 || result.status === null,
    output: outputLines.join('\n') || `Exit code: ${result.status}`,
    modified: before !== after,
  };
}

export function runFormatters(
  commands: string[],
  workspaceRoot: string
): FormatterResult[] {
  return commands.map((cmd) => runFormatter(cmd, workspaceRoot));
}
