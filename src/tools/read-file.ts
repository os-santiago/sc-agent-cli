import { readFile } from 'node:fs/promises';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';

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
    const content = await readFile(safePath, 'utf-8');
    return content;
  },
};
