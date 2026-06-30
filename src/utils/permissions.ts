import prompts from 'prompts';
import chalk from 'chalk';
import type { ProjectConfig } from '../core/types.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isDangerousCommand, formatDangerousWarning } from './dangerous-commands.js';

export interface PermissionContext {
  toolName: string;
  args: Record<string, unknown>;
  config: ProjectConfig;
  autoApprove?: boolean; // Override from CLI flag
}

// Track session-level permissions (reset when process ends)
const sessionAutoApprove = new Set<string>();

// Clear session permissions (used when switching to "always ask" mode)
export function clearSessionPermissions(): void {
  sessionAutoApprove.clear();
}

const MAX_INLINE_VALUE_LENGTH = 100;
const MAX_PREVIEW_LENGTH = 60;

function truncateInline(value: string, maxLength = MAX_INLINE_VALUE_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function summarizeTextPayload(label: string, value: string): string {
  const normalizedPreview = value.replace(/\s+/g, ' ').trim();
  const preview = normalizedPreview
    ? `, preview="${truncateInline(normalizedPreview, MAX_PREVIEW_LENGTH)}"`
    : '';

  return `${label}: ${value.length} chars, ${value.split('\n').length} lines${preview}`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatPermissionDetails(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === 'write_file') {
    const pathValue = typeof args.path === 'string' ? args.path : undefined;
    const contentValue = typeof args.content === 'string' ? args.content : undefined;

    return [
      ...(pathValue ? [`Path: ${truncateInline(pathValue)}`] : []),
      ...(contentValue !== undefined ? [summarizeTextPayload('Content', contentValue)] : []),
    ];
  }

  if (toolName === 'edit_file') {
    const pathValue = typeof args.path === 'string' ? args.path : undefined;
    const patchValue = typeof args.patch === 'string' ? args.patch : undefined;

    return [
      ...(pathValue ? [`Path: ${truncateInline(pathValue)}`] : []),
      ...(patchValue !== undefined ? [summarizeTextPayload('Patch', patchValue)] : []),
    ];
  }

  if (toolName === 'run_shell') {
    const commandValue = typeof args.command === 'string' ? args.command : undefined;

    return commandValue ? [`Command: ${truncateInline(commandValue)}`] : [];
  }

  return Object.entries(args).map(([key, value]) => {
    if (typeof value === 'string') {
      return `${key}: ${truncateInline(value)}`;
    }

    return `${key}: ${truncateInline(safeJsonStringify(value))}`;
  });
}

export async function requestPermission(ctx: PermissionContext): Promise<boolean> {
  // Auto-approve if explicitly set in context
  if (ctx.autoApprove) return true;

  // Check permission profile
  const permissionProfile = ctx.config.permissions?.profile || 'traditional';

  // BLACKLIST MODE: Only ask for dangerous commands
  if (permissionProfile === 'blacklist' && ctx.toolName === 'run_shell') {
    const command = (ctx.args.command as string) || '';
    const dangerCheck = isDangerousCommand(command);

    if (!dangerCheck.isDangerous) {
      // Safe command - auto-approve
      return true;
    }

    // Dangerous command - show warning and ask
    console.log(chalk.gray('\n  ┌─ Dangerous Command Alert ──────────────────────────────┐'));
    console.log(chalk.gray(`  │ ${chalk.red('⚠️')}  Tool: ${ctx.toolName}`));
    console.log(chalk.gray(`  │    Command: ${command}`));
    console.log(chalk.gray('  │'));

    const warning = formatDangerousWarning(dangerCheck.matches);
    warning.split('\n').forEach(line => {
      console.log(chalk.gray(`  │    ${chalk.yellow(line)}`));
    });

    console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));

    const response = await prompts({
      type: 'confirm',
      name: 'approved',
      message: chalk.red('This command is potentially dangerous. Allow anyway?'),
      initial: false,
    });

    if (response.approved === false) {
      console.log(chalk.gray(`\n   ℹ️  Action denied. The agent will try another approach.\n`));
      return false;
    }

    return response.approved ?? false;
  }

  // TRADITIONAL MODE: Continue with normal permission flow
  // Check session-level auto-approve
  if (sessionAutoApprove.has(ctx.toolName)) {
    return true;
  }

  // Check auto-approve list in config
  const autoApproveList = ctx.config.permissions?.autoApprove || [];
  if (autoApproveList.includes(ctx.toolName)) {
    return true;
  }

  // Ask user with helpful context
  console.log(chalk.gray('\n  ┌─ Permission ────────────────────────────────────────────┐'));
  console.log(chalk.gray(`  │ ${chalk.yellow('🔐')} Tool: ${ctx.toolName}`));
  const permissionDetails = formatPermissionDetails(ctx.toolName, ctx.args);
  permissionDetails.forEach(line => {
    console.log(chalk.gray(`  │    ${line}`));
  });
  console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));

  const response = await prompts({
    type: 'select',
    name: 'choice',
    message: 'Allow this action?',
    choices: [
      { title: 'Yes (once)', value: 'yes', description: 'Allow this time only' },
      { title: 'Always (save to config)', value: 'always', description: 'Auto-approve forever' },
      { title: 'Session (until exit)', value: 'session', description: 'Auto-approve this session' },
      { title: 'No (deny)', value: 'no', description: 'Deny this action' },
    ],
    initial: 0, // Default to "Yes (once)"
  });

  const choice = response.choice;

  if (!choice || choice === 'no') {
    console.log(chalk.gray(`\n   ℹ️  Action denied. The agent will try another approach.\n`));
    return false;
  }

  if (choice === 'always') {
    // Save to config permanently
    try {
      const configDir = path.join(homedir(), '.sc-agent');
      const configPath = path.join(configDir, 'config.json');

      // Ensure directory exists
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      // Read or create config
      let configContent: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        const fileContent = readFileSync(configPath, 'utf-8');
        configContent = JSON.parse(fileContent);
      }

      interface PermissionsConfig {
        autoApprove?: string[];
        profile?: 'traditional' | 'blacklist';
        denyPaths?: string[];
      }
      const permissions = (configContent.permissions as PermissionsConfig) || {};
      if (!permissions.autoApprove) {
        permissions.autoApprove = [];
      }
      if (!permissions.autoApprove.includes(ctx.toolName)) {
        permissions.autoApprove.push(ctx.toolName);
        configContent.permissions = permissions;
        writeFileSync(configPath, JSON.stringify(configContent, null, 2));
        console.log(chalk.gray(`\n   ✓ Added "${ctx.toolName}" to auto-approve list\n`));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.gray(`\n   ⚠️  Could not save to config: ${errorMsg}`));
      console.log(chalk.gray(`   Approved for this session only\n`));
      sessionAutoApprove.add(ctx.toolName);
    }
    return true;
  }

  if (choice === 'session') {
    sessionAutoApprove.add(ctx.toolName);
    console.log(chalk.gray(`\n   ✓ "${ctx.toolName}" auto-approved for this session\n`));
    return true;
  }

  // choice === 'yes'
  return true;
}
