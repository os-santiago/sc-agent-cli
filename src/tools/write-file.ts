import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';
import { requestPermission } from '../utils/permissions.js';

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

    // Check content size before writing
    const maxBytes = ctx.config.settings?.maxWriteFileBytes ?? 10 * 1024 * 1024; // 10 MB default
    const contentBytes = Buffer.byteLength(content, 'utf-8');
    if (contentBytes > maxBytes) {
      throw new Error(
        `Content too large (${(contentBytes / 1024 / 1024).toFixed(1)} MB). ` +
        `Maximum write size: ${(maxBytes / 1024 / 1024).toFixed(1)} MB. ` +
        `Set maxWriteFileBytes in config to increase.`
      );
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
    await mkdir(path.dirname(safePath), { recursive: true });
    await writeFile(safePath, content, 'utf-8');

    return `File written successfully: ${filePath}`;
  },
};
