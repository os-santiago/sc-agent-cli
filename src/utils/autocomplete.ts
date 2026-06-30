import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, sep } from 'node:path';

// Available slash commands
export const SLASH_COMMANDS = [
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
    if (pathMatches.length > 0) {
      return [pathMatches, trimmedLine];
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

export function isKnownSlashCommand(command: string): boolean {
  return SLASH_COMMANDS.includes(normalizeSlashCommand(command));
}

export function getSlashCommandSuggestions(command: string): string[] {
  const normalizedCommand = normalizeSlashCommand(command);
  const prefixMatches = SLASH_COMMANDS.filter((slashCommand) => slashCommand.startsWith(normalizedCommand));

  if (prefixMatches.length > 0) {
    return prefixMatches.slice(0, 3);
  }

  return [...SLASH_COMMANDS]
    .map((slashCommand) => ({
      slashCommand,
      distance: levenshteinDistance(normalizedCommand, slashCommand),
    }))
    .filter(({ distance }) => distance <= 4)
    .sort((a, b) => a.distance - b.distance || a.slashCommand.localeCompare(b.slashCommand))
    .slice(0, 3)
    .map(({ slashCommand }) => slashCommand);
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

function autocompleteFilePath(line: string, workspaceRoot: string): string[] {
  // Extract potential path from the line
  const pathMatch = line.match(/(?:^|\s)(\.{0,2}\/[^\s]*|~\/[^\s]*|[a-zA-Z]:[^\s]*)/);
  if (!pathMatch) return [];

  let partialPath = pathMatch[1];
  let basePath = workspaceRoot;

  // Handle different path types
  if (partialPath.startsWith('~/')) {
    basePath = process.env.HOME || process.env.USERPROFILE || workspaceRoot;
    partialPath = partialPath.substring(2);
  } else if (partialPath.startsWith('./')) {
    partialPath = partialPath.substring(2);
  } else if (partialPath.startsWith('../')) {
    basePath = dirname(workspaceRoot);
    partialPath = partialPath.substring(3);
  }

  // Resolve full path
  const fullPath = partialPath ? join(basePath, partialPath) : basePath;
  const dirPath = partialPath.includes(sep) ? dirname(fullPath) : basePath;
  const prefix = basename(fullPath);

  // Get matching files/directories
  try {
    if (!existsSync(dirPath)) return [];

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const matches = entries
      .filter(entry => {
        if (prefix && !entry.name.startsWith(prefix)) return false;
        return true;
      })
      .map(entry => {
        const fullEntryPath = join(dirPath, entry.name);
        const isDir = entry.isDirectory();
        return isDir ? `${entry.name}/` : entry.name;
      })
      .slice(0, 20); // Limit to 20 suggestions

    return matches;
  } catch (err) {
    return [];
  }
}

// Custom completer for readline
export function createCompleter(workspaceRoot: string) {
  return function completer(line: string): [string[], string] {
    return autocomplete(line, workspaceRoot);
  };
}

function normalizeSlashCommand(command: string): string {
  return command.trim().toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    distances[i][0] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    distances[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + substitutionCost
      );
    }
  }

  return distances[rows - 1][cols - 1];
}
