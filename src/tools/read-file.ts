import { readFile } from 'node:fs/promises';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';

function formatReadFileError(filePath: string, error: unknown): Error {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code?: unknown }).code);

    if (code === 'ENOENT') {
      return new Error(
        `File not found: ${filePath}. Check the path and use list_dir to inspect nearby files.`
      );
    }

    if (code === 'EISDIR') {
      return new Error(
        `Cannot read ${filePath} because it is a directory. Use list_dir to inspect its contents.`
      );
    }
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export const readFileTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workspace root)',
          },
        },
        required: ['path'],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = args.path as string;
    if (!filePath) {
      throw new Error('Missing required argument: path');
    }

    const safePath = resolveSafePath(filePath, ctx.workspaceRoot, ctx.config);
    try {
      const content = await readFile(safePath, 'utf-8');
      return content;
    } catch (error: unknown) {
      throw formatReadFileError(filePath, error);
    }
  },
};
