import { readFile, writeFile } from 'node:fs/promises';
import { applyPatch, parsePatch, type StructuredPatch } from 'diff';
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
    validateEOFPositions(parsed, content);
    // The diff library searches offsets starting at oldStart, including positions beyond
    // EOF. A huge model-supplied anchor can otherwise monopolize the event loop.
    const sourceLines = content.split(/\r\n|\n/).length;
    const outsideSource = parsed.hunks.some(hunk => hunk.oldStart > sourceLines + 1);
    const patched = outsideSource ? false : applyPatch(content, parsed, { autoConvertLineEndings: false });

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

function parseSingleFilePatch(patch: string): StructuredPatch {
  const invalid = () => new Error('Failed to apply patch: invalid unified diff format. Expected exactly one file with valid @@ -start,count +start,count @@ hunks (counts may be omitted).');
  let files: StructuredPatch[];
  try {
    files = parsePatch(patch);
  } catch {
    throw invalid();
  }
  if (files.length !== 1 || files[0].hunks.length === 0) throw invalid();

  // The library accepts NaN anchors and normalizes a missing one-line body
  // to zero lines, even in strict mode. Check the original declarations too.
  const headers = patch.split(/\r\n|\n/).filter(line => line.startsWith('@@'));
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
      || hunk.lines.some(line => line.startsWith('\\') && line.replace(/\r$/, '') !== '\\ No newline at end of file')) {
      throw invalid();
    }
  }
  let oldEOF = false, newEOF = false, oldEnd = 0, newEnd = 0;
  for (const hunk of files[0].hunks) {
    if (oldEOF || newEOF || hunk.oldStart < oldEnd || hunk.newStart < newEnd) throw invalid();
    oldEnd = hunk.oldStart + hunk.oldLines;
    newEnd = hunk.newStart + hunk.newLines;
    if (!Number.isSafeInteger(oldEnd) || !Number.isSafeInteger(newEnd)) throw invalid();
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i];
      if (line.startsWith('\\')) {
        const previous = hunk.lines[i - 1];
        // An empty result is represented by a zero-line range, avoiding the
        // ambiguous empty-line EOF form that hung the prior diff dependency.
        if (!previous || previous.replace(/\r$/, '').length < 2 || !['+', '-', ' '].includes(previous[0])) throw invalid();
        if (previous[0] !== '+') oldEOF = true;
        if (previous[0] !== '-') newEOF = true;
      } else if ((oldEOF && line[0] !== '+') || (newEOF && line[0] !== '-')) {
        // No later context or content may follow that side's EOF marker.
        throw invalid();
      }
    }
  }
  return files[0];
}

// EOF edits must match the current source positions exactly. Relocating a hunk
// while changing EOF could otherwise alter a newline outside the edited range.
function validateEOFPositions(patch: StructuredPatch, content: string): void {
  if (!patch.hunks.some(hunk => hunk.lines.some(line => line.startsWith('\\')))) return;
  const source = content.split('\n');
  const sourceCount = source.length - (content.endsWith('\n') || content === '' ? 1 : 0);
  for (const hunk of patch.hunks) {
    let position = hunk.oldStart - 1;
    for (const line of hunk.lines) {
      if (line.startsWith('-') || line.startsWith(' ')) {
        if (source[position++] !== line.slice(1)) throw new Error('Patch does not match file content: EOF edits require current line positions.');
      }
    }
    if (hunk.lines.some(line => line.startsWith('\\')) && position !== sourceCount) {
      throw new Error('Failed to apply patch: invalid unified diff format. EOF marker does not refer to the end of the file.');
    }
    if (content.endsWith('\n') && hunk.lines.some((line, i) => line.startsWith('\\') && hunk.lines[i - 1][0] !== '+')) {
      throw new Error('Patch does not match file content: the original file has a final newline.');
    }
  }
}
