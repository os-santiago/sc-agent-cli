import { readFile, stat } from 'node:fs/promises';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';

const DEFAULT_MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB

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

    // Check file size before reading
    const maxBytes = ctx.config.settings?.maxReadFileBytes ?? DEFAULT_MAX_READ_BYTES;
    const stats = await stat(safePath);
    if (stats.size > maxBytes) {
      throw new Error(
        `File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). ` +
        `Maximum read size: ${(maxBytes / 1024 / 1024).toFixed(1)} MB. ` +
        `Set maxReadFileBytes in config to increase.`
      );
    }

    const content = await readFile(safePath, 'utf-8');
    return content;
  },
};
