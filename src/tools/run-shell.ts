import { spawn } from 'node:child_process';
import type { Tool, ToolContext } from './tool.js';
import { requestPermission } from '../utils/permissions.js';

function extractCommandName(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^"([^"]+)"|'([^']+)'|(\S+)/);

  return match?.[1] || match?.[2] || match?.[3] || command;
}

function isCommandNotFound(output: string, platform: NodeJS.Platform): boolean {
  const normalized = output.toLowerCase();

  if (platform === 'win32') {
    return normalized.includes('is not recognized as an internal or external command');
  }

  return normalized.includes('command not found') || normalized.includes('not found');
}

export function formatRunShellFailure(
  command: string,
  code: number,
  stdout: string,
  stderr: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
  let message = `Command exited with code ${code}\n${output}`;

  if (isCommandNotFound(output, platform)) {
    const commandName = extractCommandName(command);
    const tip = platform === 'win32'
      ? `Tip: "${commandName}" is not available in this Windows shell. Check PATH, install it, use the PowerShell equivalent, or run it via WSL if it is a Unix-only command.`
      : `Tip: "${commandName}" is not available in this shell. Check PATH, install it, or use the correct binary for this environment.`;

    message += `\n${tip}`;
  }

  return message;
}

export const runShellTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Execute a shell command (requires explicit permission)',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)',
          },
        },
        required: ['command'],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const command = args.command as string;
    const timeout = (args.timeout as number) || 30000;

    if (!command) {
      throw new Error('Missing required argument: command');
    }

    const approved = await requestPermission({
      toolName: 'run_shell',
      args,
      config: ctx.config,
      autoApprove: ctx.autoApprove,
    });

    if (!approved) {
      throw new Error('Permission denied by user');
    }

    return new Promise((resolve, reject) => {
      // Use shell:true for cross-platform compatibility (cmd.exe on Windows, /bin/sh on POSIX)
      const child = spawn(command, [], {
        shell: true,
        cwd: ctx.workspaceRoot,
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(formatRunShellFailure(command, code ?? -1, stdout, stderr)));
        } else {
          const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
          resolve(output || '(no output)');
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to execute command: ${err.message}`));
      });
    });
  },
};
