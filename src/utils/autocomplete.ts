import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';

// Available slash commands
const SLASH_COMMANDS = [
  '/help',
  '/model',
  '/permissions',
  '/profile',
  '/pre-approved-commands',
  '/storage',
  '/reload',
  '/clear',
  '/info',
];

// Available tools
const TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'search_text',
  'run_shell',
];

export function autocomplete(line: string, workspaceRoot: string): [string[], string] {
  const trimmedLine = line.trimStart();

  // Autocomplete slash commands
  if (trimmedLine.startsWith('/')) {
    const matches = SLASH_COMMANDS.filter(cmd => cmd.startsWith(trimmedLine));
    return [matches, trimmedLine];
  }

  // Autocomplete file paths (when line contains common path indicators)
  if (containsPathIndicators(trimmedLine)) {
    const pathMatches = autocompleteFilePath(trimmedLine, workspaceRoot);
    if (pathMatches) {
      return [pathMatches.matches, pathMatches.token];
    }
  }

  // Autocomplete tool names (when user mentions tools)
  if (containsToolIndicators(trimmedLine)) {
    const toolMatches = TOOLS.filter(tool =>
      trimmedLine.toLowerCase().includes(tool.substring(0, 4))
    );
    if (toolMatches.length > 0) {
      return [toolMatches, trimmedLine];
    }
  }

  // No matches
  return [[], trimmedLine];
}

interface PathCompletion {
  matches: string[];
  token: string;
}

function containsPathIndicators(line: string): boolean {
  const indicators = [
    '/',
    '\\',
    './',
    '../',
    '~/',
    'file:',
    'path:',
    'in ',
    'from ',
    'read ',
    'write ',
    'open ',
    'edit ',
  ];

  const lowerLine = line.toLowerCase();
  return indicators.some(indicator => lowerLine.includes(indicator));
}

function containsToolIndicators(line: string): boolean {
  const indicators = [
    'tool',
    'use ',
    'run ',
    'execute ',
    'call ',
  ];

  const lowerLine = line.toLowerCase();
  return indicators.some(indicator => lowerLine.includes(indicator));
}

function autocompleteFilePath(line: string, workspaceRoot: string): PathCompletion | null {
  const token = extractPathToken(line);
  if (!token) {
    return null;
  }

  const preferredSeparator = token.includes('\\') ? '\\' : '/';
  const normalizedToken = token.replace(/[\\/]/g, sep);
  let basePath = workspaceRoot;
  let relativePath = normalizedToken;

  if (token.startsWith(`~${preferredSeparator}`)) {
    basePath = process.env.HOME || process.env.USERPROFILE || workspaceRoot;
    relativePath = normalizedToken.substring(2);
  } else if (/^[a-zA-Z]:[\\/]/.test(token)) {
    basePath = normalizedToken.slice(0, 3);
    relativePath = normalizedToken.slice(3);
  } else if (normalizedToken.startsWith(`.${sep}`)) {
    relativePath = normalizedToken.substring(2);
  } else if (normalizedToken.startsWith(`..${sep}`)) {
    basePath = dirname(workspaceRoot);
    relativePath = normalizedToken.substring(3);
  }

  const lastSeparatorIndex = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));
  const relativeDir = lastSeparatorIndex >= 0 ? relativePath.slice(0, lastSeparatorIndex + 1) : '';
  const prefix = lastSeparatorIndex >= 0 ? relativePath.slice(lastSeparatorIndex + 1) : relativePath;
  const typedDirPrefix = getTypedDirPrefix(token);
  const dirPath = join(basePath, relativeDir);

  try {
    if (!existsSync(dirPath)) {
      return null;
    }

    const matches = readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.name.startsWith(prefix))
      .map(entry => {
        const suffix = entry.isDirectory() ? preferredSeparator : '';
        return `${typedDirPrefix}${entry.name}${suffix}`;
      })
      .slice(0, 20);

    if (matches.length === 0) {
      return null;
    }

    return { matches, token };
  } catch {
    return null;
  }
}

function extractPathToken(line: string): string | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const token = tokens.at(-1);

  if (!token || token.startsWith('/')) {
    return null;
  }

  if (!token.includes('/') && !token.includes('\\') && !token.startsWith('~')) {
    return null;
  }

  return token;
}

function getTypedDirPrefix(token: string): string {
  const lastSeparatorIndex = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  if (lastSeparatorIndex === -1) {
    return '';
  }

  return token.slice(0, lastSeparatorIndex + 1);
}

// Custom completer for readline
export function createCompleter(workspaceRoot: string) {
  return function completer(line: string): [string[], string] {
    return autocomplete(line, workspaceRoot);
  };
}
