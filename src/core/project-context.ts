import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const CONTEXT_FILES = ['AGENTS.md', 'SC-AGENT.md', 'CLAUDE.md'];

// Cache to avoid re-reading context files in the same session
interface ContextCache {
  workspaceRoot: string;
  policyFile?: string;
  content: string | null;
}

let contextCache: ContextCache | null = null;

export async function loadProjectContext(
  workspaceRoot: string,
  policyFile?: string
): Promise<string | null> {
  // Return cached content if same workspace and policy
  if (
    contextCache &&
    contextCache.workspaceRoot === workspaceRoot &&
    contextCache.policyFile === policyFile
  ) {
    return contextCache.content;
  }

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

  const result = parts.length > 0 ? parts.join('\n\n---\n\n') : null;

  // Cache the result
  contextCache = { workspaceRoot, policyFile, content: result };

  return result;
}

// Clear cache (useful for testing or when workspace changes)
export function clearProjectContextCache(): void {
  contextCache = null;
}
