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
            description: 'Glob pattern for files to search (e.g. "**/*.ts"). Alias: path',
          },
          path: {
            type: 'string',
            description: 'Specific file or glob path to search (alias for glob). Example: "src/*.ts"',
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
    const globPattern = (args.path as string) || (args.glob as string) || '';
    const useRegex = (args.regex as boolean) || false;

    if (!pattern) {
      throw new Error('Missing required argument: pattern');
    }

    if (!globPattern) {
      return 'Error: missing search path. Specify which file(s) to search using "path" (e.g. "src/*.ts") or "glob". Searching all files is not allowed for performance reasons.';
    }

    const regex = useRegex ? new RegExp(pattern, 'i') : null;
    const files = await fg(globPattern, {
      cwd: ctx.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
    });

    if (files.length > 50) {
      return `Error: pattern "${globPattern}" matched ${files.length} files (max 50). Narrow your search with a more specific glob (e.g. "src/**/*.ts", "scripts/*.gd").`;
    }

    const results: string[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB total

    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        totalBytes += Buffer.byteLength(content, 'utf-8');
        if (totalBytes > MAX_BYTES) {
          results.push(`⚠️  Search stopped: total content exceeds 10MB limit. Narrow your search.`);
          break;
        }
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
      } catch {
        // Skip files that can't be read (binary, etc.)
      }
    }

    return results.length > 0 ? results.join('\n\n') : 'No matches found';
  },
};
