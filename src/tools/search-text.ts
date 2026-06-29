import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import type { Tool, ToolContext } from './tool.js';

export const searchTextTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_text',
      description: 'Search for text patterns in files (supports glob patterns)',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text pattern to search for (plain string or regex)',
          },
          glob: {
            type: 'string',
            description: 'Glob pattern for files to search (e.g. "**/*.ts")',
          },
          regex: {
            type: 'boolean',
            description: 'Treat pattern as regex (default: false)',
          },
        },
        required: ['pattern'],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = args.pattern as string;
    const globPattern = (args.glob as string) || '**/*';
    const useRegex = (args.regex as boolean) || false;

    if (!pattern) {
      throw new Error('Missing required argument: pattern');
    }

    const regex = createSearchRegex(pattern, useRegex);
    const files = await fg(globPattern, {
      cwd: ctx.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    const results: string[] = [];

    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const lines = content.split('\n');
        const matches: string[] = [];

        lines.forEach((line, idx) => {
          const found = regex ? regex.test(line) : line.toLowerCase().includes(pattern.toLowerCase());
          if (found) {
            matches.push(`  ${idx + 1}: ${line.trim()}`);
          }
        });

        if (matches.length > 0) {
          results.push(`${file}:\n${matches.join('\n')}`);
        }
      } catch (err: unknown) {
        // Skip files that can't be read (binary, etc.)
      }
    }

    return results.length > 0 ? results.join('\n\n') : 'No matches found';
  },
};

function createSearchRegex(pattern: string, useRegex: boolean): RegExp | null {
  if (!useRegex) {
    return null;
  }

  try {
    return new RegExp(pattern, 'i');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid regex pattern "${pattern}": ${errorMsg}\nUse regex=false to search for this text literally.`
    );
  }
}
