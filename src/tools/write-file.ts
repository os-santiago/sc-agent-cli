import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';
import { requestPermission } from '../utils/permissions.js';

function formatWriteFileError(filePath: string, error: unknown): Error {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EISDIR') {
    return new Error(
      `Cannot write to "${filePath}" because it is a directory.\n` +
      `💡 Tip: Provide a file path instead, for example "${path.posix.join(filePath.replace(/\\\\/g, '/'), 'notes.txt')}"`
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

export const writeFileTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file (creates or overwrites)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workspace root)',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = args.path as string;
    const content = args.content as string;

    if (!filePath || content === undefined) {
      throw new Error('Missing required arguments: path, content');
    }

    const approved = await requestPermission({
      toolName: 'write_file',
      args,
      config: ctx.config,
      autoApprove: ctx.autoApprove,
    });

    if (!approved) {
      throw new Error('Permission denied by user');
    }

    const safePath = resolveSafePath(filePath, ctx.workspaceRoot, ctx.config);
    try {
      await mkdir(path.dirname(safePath), { recursive: true });
      await writeFile(safePath, content, 'utf-8');
    } catch (error) {
      throw formatWriteFileError(filePath, error);
    }

    return `File written successfully: ${filePath}`;
  },
};
