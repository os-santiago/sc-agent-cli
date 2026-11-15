import { readFile, writeFile } from 'node:fs/promises';
import { applyPatch, parsePatch, type ParsedDiff } from 'diff';
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
    const filePath = args.path;
    const patch = args.patch;

    if (!filePath || !patch) {
      throw new Error('Missing required arguments: path, patch');
    }
    if (typeof filePath !== 'string' || typeof patch !== 'string') {
      throw new Error('Arguments path and patch must be non-empty strings');
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
    const parsed = parseSingleFilePatch(patch);
    // diff@5 searches offsets starting at oldStart, including positions beyond
    // EOF. A huge model-supplied anchor can otherwise monopolize the event loop.
    const sourceLines = content.split(/\r\n|[\n\v\f\r\x85]/).length;
    const outsideSource = parsed.hunks.some(hunk => hunk.oldStart > sourceLines + 1);
    const patched = outsideSource ? false : applyPatch(content, parsed);

    if (patched === false) {
      // Extract a snippet from the patch to show what was being matched
      const contextLines = patch.split('\n').slice(0, 10).join('\n');
      throw new Error(
        `Patch does not match file content in ${filePath}. ` +
        `The file may have been modified since the patch was generated. ` +
        `First lines of patch:\n${contextLines}`
      );
    }

    if (patched === content) {
      throw new Error(`Patch produces no changes in ${filePath}. Read the current file and generate a patch that changes its content.`);
    }

    await writeFile(safePath, patched, 'utf-8');
    return `Patch applied successfully: ${filePath}`;
  },
};

function parseSingleFilePatch(patch: string): ParsedDiff {
  const invalid = () => new Error('Failed to apply patch: invalid unified diff format. Expected exactly one file with valid @@ -start,count +start,count @@ hunks (counts may be omitted).');
  let files: ParsedDiff[];
  try {
    files = parsePatch(patch, { strict: true });
  } catch {
    throw invalid();
  }
  if (files.length !== 1 || files[0].hunks.length === 0) throw invalid();

  // The library accepts NaN anchors and normalizes a missing one-line body
  // to zero lines, even in strict mode. Check the original declarations too.
  const headers = patch.split(/\r\n|[\n\v\f\r\x85]/).filter(line => line.startsWith('@@'));
  if (headers.length !== files[0].hunks.length) throw invalid();
  for (let i = 0; i < headers.length; i++) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(headers[i]);
    if (!match) throw invalid();
    const oldStart = Number(match[1]), oldLines = Number(match[2] ?? 1);
    const newStart = Number(match[3]), newLines = Number(match[4] ?? 1);
    const hunk = files[0].hunks[i];
    if (![oldStart, oldLines, newStart, newLines, hunk.oldStart, hunk.newStart].every(Number.isSafeInteger)
      || (oldStart === 0 && oldLines !== 0) || (newStart === 0 && newLines !== 0)
      || oldLines !== hunk.oldLines || newLines !== hunk.newLines
      || hunk.lines.some(line => line.startsWith('\\') && line !== '\\ No newline at end of file')) {
      throw invalid();
    }
  }
  return files[0];
}
