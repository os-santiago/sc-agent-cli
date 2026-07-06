import path from 'node:path';
import { realpathSync } from 'node:fs';
import ignore from 'ignore';
import { getGlobalConfigPath } from '../core/config.js';
import type { ProjectConfig } from '../core/types.js';

export function resolveSafePath(
  inputPath: string,
  workspaceRoot: string,
  config: ProjectConfig
): string {
  // Resolve workspace root real path first — if it can't be resolved, deny
  let wsReal: string;
  try {
    wsReal = realpathSync(workspaceRoot);
  } catch {
    throw new Error(
      `Access denied: cannot resolve workspace root "${workspaceRoot}".\n` +
      `  The workspace directory may not exist or is inaccessible.`
    );
  }

  // Resolve to absolute path
  const resolved = path.resolve(wsReal, inputPath);

  // Resolve symlinks: verify the REAL path is within the workspace
  let realResolved: string;
  try {
    realResolved = realpathSync(resolved);
  } catch {
    realResolved = resolved;
  }

  // Ensure real path is within workspace
  if (realResolved !== wsReal && !realResolved.startsWith(wsReal + path.sep)) {
    throw new Error(
      `Access denied: "${inputPath}" is outside the workspace.\n` +
      `  Workspace root: ${workspaceRoot}\n` +
      `  Requested path: ${resolved}\n\n` +
      `💡 Tip: I can only access files within the current workspace for security.\n` +
      `   For safety, you cannot work with files outside the workspace root during this session.\n` +
      `   If you must edit or read files from a git branch, checkout the branch directly within the workspace (e.g. using git checkout or git stash).`
    );
  }

  // Check deny patterns
  const denyPatterns = config.permissions?.denyPaths || [];
  if (denyPatterns.length > 0) {
    const ig = ignore().add(denyPatterns);
    const relativePath = path.relative(wsReal, resolved);
    if (relativePath && ig.ignores(relativePath)) {
      throw new Error(
        `Access denied: "${inputPath}" matches a deny pattern.\n` +
        `  Denied patterns: ${denyPatterns.join(', ')}\n\n` +
        `💡 Tip: This file is blocked for security (likely contains secrets).\n` +
        `   To modify deny patterns, edit: ${getGlobalConfigPath()}`
      );
    }
  }

  return realResolved;
}
