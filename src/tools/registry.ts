import type { Tool } from './tool.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { listDirTool } from './list-dir.js';
import { searchTextTool } from './search-text.js';
import { runShellTool } from './run-shell.js';

export const ALL_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  searchTextTool,
  runShellTool,
];

export function getToolByName(name: string): Tool | undefined {
  return ALL_TOOLS.find((t) => t.definition.function.name === name);
}
