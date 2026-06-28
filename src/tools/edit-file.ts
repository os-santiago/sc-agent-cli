import { readFile, writeFile } from 'node:fs/promises';
import { applyPatch } from 'diff';
import type { Tool, ToolContext } from './tool.js';
import { resolveSafePath } from '../utils/path-security.js';
import { requestPermission } from '../utils/permissions.js';

export const editFileTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Apply a unified diff patch to a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workspace root)',
          },
          patch: {
            type: 'string',
            description: 'Unified diff patch to apply',
          },
        },
        required: ['path', 'patch'],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = args.path as string;
    const patch = args.patch as string;

    if (!filePath || !patch) {
      throw new Error('Missing required arguments: path, patch');
    }

    const approved = await requestPermission({
      toolName: 'edit_file',
      args,
      config: ctx.config,
      autoApprove: ctx.autoApprove,
    });

    if (!approved) {
      throw new Error('Permission denied by user');
    }

    const safePath = resolveSafePath(filePath, ctx.workspaceRoot, ctx.config);
    const content = await readFile(safePath, 'utf-8');
    const patched = applyPatch(content, patch);

    if (patched === false) {
      throw new Error('Failed to apply patch (does not match file content)');
    }

    await writeFile(safePath, patched, 'utf-8');
    return `Patch applied successfully: ${filePath}`;
  },
};
