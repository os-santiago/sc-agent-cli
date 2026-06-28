import { readdir } from 'node:fs/promises';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';

export const listDirTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories in a given path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to directory (relative to workspace root). Use "." for current directory. If empty or not provided, defaults to current directory "."',
          },
        },
        required: [],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    let dirPath = (args.path as string) || '.';

    // Handle empty string or just whitespace
    if (!dirPath || !dirPath.trim()) {
      dirPath = '.';
    }

    // Resolve ~ to home directory
    if (dirPath === '~' || dirPath.startsWith('~/')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      dirPath = dirPath === '~' ? homeDir : dirPath.replace('~/', homeDir + '/');
    }

    const safePath = resolveSafePath(dirPath, ctx.workspaceRoot, ctx.config);
    const entries = await readdir(safePath, { withFileTypes: true });

    const formatted = entries
      .map((e) => {
        const type = e.isDirectory() ? '[DIR]' : '[FILE]';
        return `${type} ${e.name}`;
      })
      .join('\n');

    return formatted || '(empty directory)';
  },
};
