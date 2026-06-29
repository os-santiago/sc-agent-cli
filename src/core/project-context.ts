import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CONTEXT_FILES = ['AGENTS.md', 'SC-AGENT.md', 'CLAUDE.md'];

export async function loadProjectContext(workspaceRoot: string): Promise<string | null> {
  const sections: string[] = [];

  for (const filename of CONTEXT_FILES) {
    const filePath = path.join(workspaceRoot, filename);
    try {
      const content = await readFile(filePath, 'utf-8');
      sections.push(`# ${filename}\n${content}`);
    } catch (err: unknown) {
      // Try next file
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}
