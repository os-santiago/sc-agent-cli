import path from 'node:path';
import ignore from 'ignore';
import { getGlobalConfigPath } from '../core/config.js';
import type { ProjectConfig } from '../core/types.js';

export function resolveSafePath(
  inputPath: string,
  workspaceRoot: string,
  config: ProjectConfig
): string {
  // Resolve to absolute path
  const resolved = path.resolve(workspaceRoot, inputPath);

  // Ensure it's within workspace (exact match or proper subdir)
  if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
    throw new Error(
      `Access denied: "${inputPath}" is outside the workspace.\n` +
      `  Workspace root: ${workspaceRoot}\n` +
      `  Requested path: ${resolved}\n\n` +
      `💡 Tip: I can only access files within the current workspace for security.\n` +
      `   To work with files in other directories, navigate there first:\n` +
      `   → Use "cd <directory>" to change workspace`
    );
  }

  // Check deny patterns
  const denyPatterns = config.permissions?.denyPaths || [];
  if (denyPatterns.length > 0) {
    const ig = ignore().add(denyPatterns);
    const relativePath = path.relative(workspaceRoot, resolved);
    // Skip empty path (workspace root itself) - ignore library rejects empty strings
    if (relativePath && ig.ignores(relativePath)) {
      throw new Error(
        `Access denied: "${inputPath}" matches a deny pattern.\n` +
        `  Denied patterns: ${denyPatterns.join(', ')}\n\n` +
        `💡 Tip: This file is blocked for security (likely contains secrets).\n` +
        `   To modify deny patterns, edit: ${getGlobalConfigPath()}`
      );
    }
  }

  return resolved;
}
