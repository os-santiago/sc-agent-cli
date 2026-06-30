import prompts from 'prompts';
import chalk from 'chalk';
import type { ProjectConfig } from '../core/types.js';
import { updateGlobalConfig } from '../core/config.js';
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
  console.log(chalk.gray(`  │    Args: ${JSON.stringify(ctx.args)}`));
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
      let added = false;
      await updateGlobalConfig((config) => {
        if (!config.permissions) {
          config.permissions = {};
        }
        if (!config.permissions.autoApprove) {
          config.permissions.autoApprove = [];
        }
        if (!config.permissions.autoApprove.includes(ctx.toolName)) {
          config.permissions.autoApprove.push(ctx.toolName);
          added = true;
        }
      });
      if (added) {
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
