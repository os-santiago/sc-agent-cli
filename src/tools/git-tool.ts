import { spawnSync } from 'node:child_process';
import type { Tool, ToolContext } from './tool.js';
import { requestPermission } from '../utils/permissions.js';

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Git error: ${result.error.message}`, { cause: result.error });
  }

  const stderr = (result.stderr || '').trim();
  if (result.status !== 0) {
    throw new Error(stderr || `Git exited with code ${result.status}`);
  }

  return (result.stdout || '').trim();
}

export const gitTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'git',
      description: 'Execute git operations. Supports status, diff, log, show, branch, add, commit.',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['status', 'diff', 'log', 'show', 'branch', 'add', 'commit'],
            description: 'Git operation to perform',
          },
          paths: {
            type: 'string',
            description: 'File paths or ref for the operation',
          },
          limit: {
            type: 'number',
            description: 'Limit for log/branch (default: 10)',
          },
          message: {
            type: 'string',
            description: 'Commit message (required for commit)',
          },
        },
        required: ['operation'],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const operation = args.operation as string;
    const paths = (args.paths as string) || '';
    const limit = (args.limit as number) || 10;
    const message = args.message as string;

    const approved = await requestPermission({
      toolName: 'git',
      args,
      config: ctx.config,
      autoApprove: ctx.autoApprove,
    });

    if (!approved) {
      throw new Error('Permission denied by user');
    }

    // Verify git is available
    const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf-8', windowsHide: true, timeout: 5000 });
    if (gitCheck.error || gitCheck.status !== 0) {
      throw new Error('Git is not installed or not in PATH');
    }

    switch (operation) {
      case 'status': {
        const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], ctx.workspaceRoot);
        const short = runGit(['status', '--short'], ctx.workspaceRoot);
        if (!short) return `🌿 On branch ${branch}\nClean working tree`;
        const lines = short.split('\n');
        const staged = lines.filter(l => l.trim() && !l.startsWith(' ') && !l.startsWith('?'));
        const unstaged = lines.filter(l => l.startsWith(' ') && !l.startsWith('??'));
        const untracked = lines.filter(l => l.startsWith('??'));
        let out = `🌿 On branch ${branch}\n`;
        if (staged.length) out += `\n📦 Staged (${staged.length}):\n${staged.map(s => `  ${s}`).join('\n')}`;
        if (unstaged.length) out += `\n📝 Modified (${unstaged.length}):\n${unstaged.map(s => `  ${s}`).join('\n')}`;
        if (untracked.length) out += `\n🆕 Untracked (${untracked.length}):\n${untracked.map(s => `  ${s.substring(3)}`).join('\n')}`;
        return out;
      }

      case 'diff': {
        const diff = runGit(['diff', ...(paths ? ['--', paths] : [])], ctx.workspaceRoot);
        if (!diff) return 'No changes to show.';
        return diff.length > 8000 ? diff.substring(0, 8000) + '\n\n[Diff truncated]' : diff;
      }

      case 'log': {
        const log = runGit(['log', `--oneline`, `-${limit}`, ...(paths ? ['--', paths] : [])], ctx.workspaceRoot);
        if (!log) return 'No commits found.';
        return `📜 Recent commits (last ${limit}):\n${log}`;
      }

      case 'show': {
        const ref = paths || 'HEAD';
        const show = runGit(['show', '--stat', ref], ctx.workspaceRoot);
        return show.length > 8000 ? show.substring(0, 8000) + '\n\n[Output truncated]' : show;
      }

      case 'branch': {
        const branches = runGit(['branch', '-a'], ctx.workspaceRoot);
        return `🌿 Branches:\n${branches}`;
      }

      case 'add': {
        const target = paths || '.';
        runGit(['add', target], ctx.workspaceRoot);
        const status = runGit(['status', '--short'], ctx.workspaceRoot);
        return `✓ Staged: ${target}\n${status}`;
      }

      case 'commit': {
        if (!message) throw new Error('Commit message is required for commit operation');
        const result = runGit(['commit', '-m', message], ctx.workspaceRoot);
        return `✓ ${result}`;
      }

      default:
        throw new Error(`Unknown git operation: ${operation}`);
    }
  },
};
