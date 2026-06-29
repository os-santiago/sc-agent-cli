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
            description: 'Path to directory (relative to workspace root). Use "." for current directory, never use empty string.',
            minLength: 1,
            default: '.',
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
    let entries;

    try {
      entries = await readdir(safePath, { withFileTypes: true });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error) {
        const code = error.code;

        if (code === 'ENOENT') {
          throw new Error(
            `Directory not found: "${dirPath}"\n\n` +
            '💡 Tip: Check that the path exists relative to the workspace root.\n' +
            '   Use "." for the current directory or list the parent directory first.'
          );
        }

        if (code === 'ENOTDIR') {
          throw new Error(
            `Cannot list "${dirPath}" because it is a file, not a directory.\n\n` +
            '💡 Tip: Use read_file to inspect file contents,\n' +
            '   or list_dir on the parent directory instead.'
          );
        }
      }

      throw error;
    }

    const formatted = entries
      .map((e) => {
        const type = e.isDirectory() ? '[DIR]' : '[FILE]';
        return `${type} ${e.name}`;
      })
      .join('\n');

    return formatted || '(empty directory)';
  },
};
