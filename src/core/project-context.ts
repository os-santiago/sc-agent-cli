import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const CONTEXT_FILES = ['AGENTS.md', 'SC-AGENT.md', 'CLAUDE.md'];

export async function loadProjectContext(
  workspaceRoot: string,
  policyFile?: string
): Promise<string | null> {
  const parts: string[] = [];

  // Load project-level context files (AGENTS.md, CLAUDE.md, etc.)
  for (const filename of CONTEXT_FILES) {
    const filePath = path.join(workspaceRoot, filename);
    try {
      const content = await readFile(filePath, 'utf-8');
      parts.push(`# ${filename}\n${content}`);
    } catch {
      // File doesn't exist — skip
    }
  }

  // Load external policy file if configured (e.g. ADEV.md as base doctrine)
  if (policyFile) {
    const resolvedPolicyPath = path.resolve(policyFile);
    if (existsSync(resolvedPolicyPath)) {
      try {
        const content = await readFile(resolvedPolicyPath, 'utf-8');
        parts.push(`# Policy: ${path.basename(resolvedPolicyPath)}\n${content}`);
      } catch {
        // Fail silently — policy is best-effort
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
}
