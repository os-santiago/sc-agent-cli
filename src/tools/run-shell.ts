import { spawn } from 'node:child_process';
import type { Tool, ToolContext } from './tool.js';
import { requestPermission } from '../utils/permissions.js';

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
    const timeout = parseTimeout(args.timeout);

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
      });
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
        if (timedOut) {
          reject(new Error(`Command timed out after ${timeout}ms`));
        } else if (code !== 0) {
          const signalInfo = signal ? ` (signal: ${signal})` : '';
          reject(new Error(`Command exited with code ${code}${signalInfo}\n${output}`));
        } else {
          resolve(output || '(no output)');
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(new Error(`Failed to execute command: ${err.message}`));
      });
    });
  },
};

function parseTimeout(timeoutArg: unknown): number {
  if (timeoutArg === undefined) {
    return 30000;
  }

  if (typeof timeoutArg !== 'number' || !Number.isFinite(timeoutArg) || timeoutArg <= 0) {
    throw new Error('Invalid timeout: must be a positive number in milliseconds');
  }

  return Math.floor(timeoutArg);
}
