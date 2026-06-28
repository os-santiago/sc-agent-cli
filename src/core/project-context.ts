import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CONTEXT_FILES = ['AGENTS.md', 'SC-AGENT.md', 'CLAUDE.md'];

export async function loadProjectContext(workspaceRoot: string): Promise<string | null> {
  for (const filename of CONTEXT_FILES) {
    const filePath = path.join(workspaceRoot, filename);
    try {
      const content = await readFile(filePath, 'utf-8');
      return content;
    } catch (err: unknown) {
      // Try next file
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _err = err;
    }
  }
  return null;
}
