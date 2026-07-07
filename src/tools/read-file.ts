import { readFile, stat } from 'node:fs/promises';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';

const DEFAULT_MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB

export const readFileTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the workspace. Use offset/limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workspace root)',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-indexed, default: 1)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read (default: all lines)',
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
        `Use offset/limit to read portions. ` +
        `Set maxReadFileBytes in config to increase the limit.`
      );
    }

    const content = await readFile(safePath, 'utf-8');
    const lines = content.split('\n');

    const offset = (args.offset as number) || 1;
    const limit = args.limit as number | undefined;

    if (offset < 1) {
      throw new Error('offset must be >= 1');
    }

    const startIdx = offset - 1;
    if (startIdx >= lines.length) {
      throw new Error(`Offset ${offset} exceeds file length (${lines.length} lines)`);
    }

    const slicedLines = limit ? lines.slice(startIdx, startIdx + limit) : lines.slice(startIdx);
    const result = slicedLines.join('\n');

    // Log file info for context
    const totalLines = lines.length;
    const readLines = slicedLines.length;
    const suffix = totalLines > readLines
      ? `\n\n[${readLines} lines shown, ${totalLines} total. Use offset=${offset + readLines}&limit=${limit || 50} to read more.]`
      : `\n\n[${totalLines} lines total]`;

    return result + suffix;
  },
};
