import prompts from 'prompts';
import chalk from 'chalk';
import { dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Agent } from '../../core/agent.js';
import { loadConfig, getGlobalConfigPath } from '../../core/config.js';
import { clearSessionPermissions } from '../../utils/permissions.js';
import { ensureSecureDirSync, writeFileSecureSync } from '../../utils/secure-fs.js';
import type { PermissionMode, SlashCommandHandler } from './types.js';

/** `/permissions` — choose the permission mode and auto-restore behavior. */
export const handlePermissions: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/permissions') return false;
  try {
    const { loadPermissions, savePermissions } = await import('../../utils/permissions-store.js');
    const savedPerms = loadPermissions();

    const permChoices = [
      {
        title: 'Ask once per tool (recommended)',
        value: 'ask_once',
        description: 'Prompt once per unique tool, then auto-approve for session'
      },
      {
        title: 'Always ask (safer)',
        value: 'always_ask',
        description: 'Prompt every time a tool is used'
      },
      {
        title: 'Unlimited (dangerous)',
        value: 'unlimited',
        description: 'Auto-approve all tools without asking'
      },
    ];

    // Add toggle for auto-restore on session start
    if (savedPerms.restoreOnStart) {
      permChoices.push({
        title: 'Disable auto-restore on session start',
        value: 'no_restore',
        description: 'Ask me what to do each time I start a new session'
      });
    } else {
      permChoices.push({
        title: 'Auto-restore on session start',
        value: 'auto_restore',
        description: 'Always restore last permission mode without asking'
      });
    }

    const permissionMode = await prompts({
      type: 'select',
      name: 'mode',
      message: `Select (current: ${ctx.currentPermissionMode}):`,
      choices: permChoices,
      initial: 0,
    });

    if (!permissionMode.mode) {
      console.log(chalk.gray('\nCancelled\n'));
      return true;
    }

    const selectedMode = permissionMode.mode as string;

    // Handle restore toggle options
    if (selectedMode === 'no_restore') {
      savePermissions({ restoreOnStart: false });
      console.log(chalk.gray('\n✓ Auto-restore disabled. You will be asked on next session start.\n'));
      return true;
    }
    if (selectedMode === 'auto_restore') {
      savePermissions({ restoreOnStart: true });
      console.log(chalk.gray('\n✓ Auto-restore enabled. Last mode will be restored silently.\n'));
      return true;
    }

    // Update agent with new permission mode
    ctx.currentPermissionMode = selectedMode as PermissionMode;
    savePermissions({ mode: ctx.currentPermissionMode, sessionTools: [] });

    if (selectedMode === 'unlimited') {
      ctx.agent = new Agent({
        ...ctx.options,
        config: ctx.currentConfig,
        autoApprove: true,
      });
      console.log(chalk.yellow('\n⚠️  Permission mode: Unlimited (dangerous)'));
      console.log(chalk.gray('   All tools will auto-approve without asking'));
      console.log(chalk.gray('   Use with caution!\n'));
    } else if (selectedMode === 'always_ask') {
      // Clear any session permissions when switching to always ask
      clearSessionPermissions();
      ctx.agent = new Agent({
        ...ctx.options,
        config: ctx.currentConfig,
        autoApprove: false,
      });
      console.log(chalk.green('\n✓ Permission mode: Always ask (safer)'));
      console.log(chalk.gray('   You will be prompted for every tool use\n'));
    } else {
      // ask_once - default behavior with session tracking
      ctx.agent = new Agent({
        ...ctx.options,
        config: ctx.currentConfig,
        autoApprove: false,
      });
      console.log(chalk.cyan('\n✓ Permission mode: Ask once per tool (recommended)'));
      console.log(chalk.gray('   First use of each tool prompts, then auto-approves for session\n'));
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
  }
  return true;
};

/** `/profile` — switch the permission profile (traditional/blacklist). */
export const handleProfile: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/profile') return false;
  try {
    const currentProfile = ctx.currentConfig.permissions?.profile || 'traditional';

    console.log(chalk.cyan('\n🔒 Permission Profile\n'));
    console.log(chalk.gray('Choose how permission requests are handled:\n'));

    const profileChoice = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select permission profile:',
      choices: [
        {
          title: `Traditional ${currentProfile === 'traditional' ? '(current)' : ''}`,
          value: 'traditional',
          description: 'Ask for every tool use (default behavior)',
        },
        {
          title: `Blacklist ${currentProfile === 'blacklist' ? '(current)' : ''}`,
          value: 'blacklist',
          description: 'Only ask for dangerous commands (rm, sudo, etc.)',
        },
      ],
      initial: currentProfile === 'traditional' ? 0 : 1,
    });

    if (!profileChoice.profile) {
      console.log(chalk.gray('\nCancelled\n'));
      return true;
    }

    // Save to config
    try {
      const configPath = getGlobalConfigPath();
      const configDir = dirname(configPath);

      ensureSecureDirSync(configDir);

      let config: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        const configContent = readFileSync(configPath, 'utf-8');
        config = JSON.parse(configContent);
      }

      if (!config.permissions) {
        config.permissions = {};
      }
      (config.permissions as {profile?: string}).profile = profileChoice.profile;

      writeFileSecureSync(configPath, JSON.stringify(config, null, 2));

      // Update current config
      if (!ctx.currentConfig.permissions) {
        ctx.currentConfig.permissions = {};
      }
      ctx.currentConfig.permissions.profile = profileChoice.profile;

      // Recreate agent with new config
      ctx.agent = new Agent({
        ...ctx.options,
        config: ctx.currentConfig,
        autoApprove: ctx.currentPermissionMode === 'unlimited',
      });

      if (profileChoice.profile === 'traditional') {
        console.log(chalk.green('\n✓ Permission profile: Traditional'));
        console.log(chalk.gray('   You will be asked for permission for every tool use'));
        console.log(chalk.gray('   Configure auto-approve with /pre-approved-commands\n'));
      } else {
        console.log(chalk.green('\n✓ Permission profile: Blacklist'));
        console.log(chalk.gray('   Only dangerous commands will require permission:'));
        console.log(chalk.gray('   • File deletion (rm, del)'));
        console.log(chalk.gray('   • Privilege escalation (sudo, su)'));
        console.log(chalk.gray('   • Network operations (curl | bash)'));
        console.log(chalk.gray('   • System config (chmod, crontab)'));
        console.log(chalk.gray('   • And more...'));
        console.log(chalk.gray('\n   Safe commands auto-approve automatically\n'));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n✗ Error saving config: ${errorMsg}\n`));
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
  }
  return true;
};

/** `/pre-approved-commands` — interview that writes `permissions.autoApprove`. */
export const handlePreApprovedCommands: SlashCommandHandler = async (ctx, input) => {
  const lower = input.toLowerCase();
  if (lower !== '/pre-approved-commands' && lower !== '/pre-approved-commands-interview') return false;
  try {
    console.log(chalk.cyan('\n📋 Pre-Approved Commands Interview\n'));
    console.log(chalk.gray('Answer a few questions to configure which tools can auto-approve.'));
    console.log(chalk.gray('This will update your config file for future sessions.\n'));

    const preApprovedTools: string[] = [];

    // Question 1: Read-only operations
    const q1 = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Allow reading files and listing directories without asking?',
      initial: true,
    });
    if (q1.value) {
      preApprovedTools.push('read_file', 'list_dir', 'search_text');
      console.log(chalk.gray('  ✓ Added: read_file, list_dir, search_text\n'));
    }

    // Question 2: Writing files
    const q2 = await prompts({
      type: 'confirm',
      name: 'value',
      message: `Allow writing/editing files in this directory (${ctx.options.workspaceRoot})?`,
      initial: false,
    });
    if (q2.value) {
      preApprovedTools.push('write_file', 'edit_file');
      console.log(chalk.gray('  ✓ Added: write_file, edit_file\n'));
    }

    // Question 3: Shell commands (non-admin)
    const q3 = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Allow executing shell commands (non-admin, e.g., npm, git)?',
      initial: false,
    });
    if (q3.value) {
      preApprovedTools.push('run_shell');
      console.log(chalk.gray('  ✓ Added: run_shell\n'));
    }

    // Question 4: Git operations
    const q4 = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Common git operations (status, diff, log) without asking?',
      initial: true,
    });
    if (q4.value) {
      console.log(chalk.gray('  ℹ️  Git operations use run_shell (already configured)\n'));
    }

    // Question 5: Package manager
    const q5 = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Common package manager operations (npm install, build, test)?',
      initial: false,
    });
    if (q5.value) {
      console.log(chalk.gray('  ℹ️  Package operations use run_shell (already configured)\n'));
    }

    // Question 6: Summary
    console.log(chalk.cyan('\n📊 Summary:\n'));
    if (preApprovedTools.length === 0) {
      console.log(chalk.yellow('  No tools will be auto-approved'));
      console.log(chalk.gray('  You will be asked for permission every time\n'));
    } else {
      console.log(chalk.green(`  ${preApprovedTools.length} tool(s) will be auto-approved:`));
      preApprovedTools.forEach(tool => {
        console.log(chalk.gray(`    • ${tool}`));
      });
      console.log();
    }

    // Question 7: Confirm
    const confirm = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Save this configuration permanently?',
      initial: true,
    });

    if (confirm.value) {
      // Save to config
      try {
        const configPath = getGlobalConfigPath();

        // Ensure directory exists
        const configDir = dirname(configPath);
        ensureSecureDirSync(configDir);

        // Read existing config or create new
        let config: Record<string, unknown> = {};
        if (existsSync(configPath)) {
          const configContent = readFileSync(configPath, 'utf-8');
          config = JSON.parse(configContent);
        }

        // Update permissions
        if (!config.permissions) {
          config.permissions = {};
        }
        (config.permissions as {autoApprove?: string[]}).autoApprove = preApprovedTools;

        // Write config
        writeFileSecureSync(configPath, JSON.stringify(config, null, 2));

        console.log(chalk.green('\n✓ Configuration saved to:'));
        console.log(chalk.gray(`  ${configPath}\n`));

        // Reload config
        const reloadedConfig = await loadConfig(ctx.options.workspaceRoot, { auditLog: ctx.options.auditLog });
        ctx.currentConfig = reloadedConfig;

        ctx.agent = new Agent({
          ...ctx.options,
          config: ctx.currentConfig,
          autoApprove: false,
        });

        console.log(chalk.cyan('✓ Configuration reloaded'));
        console.log(chalk.gray('  Pre-approved tools are now active\n'));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\n✗ Error saving config: ${errorMsg}\n`));
      }
    } else {
      console.log(chalk.gray('\n  Configuration not saved\n'));
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
  }
  return true;
};
