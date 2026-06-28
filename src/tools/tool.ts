import type { ToolDefinition, ProjectConfig } from '../core/types.js';

export interface ToolContext {
  workspaceRoot: string;
  config: ProjectConfig;
  autoApprove?: boolean;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
