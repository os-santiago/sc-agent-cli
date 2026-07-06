#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

// Force color support for markdown rendering and UI
if (chalk.level < 2) chalk.level = 2;
import { createRequire } from 'node:module';
import { loadConfig, initConfig, getGlobalConfigPath } from './core/config.js';
import { startChatSession } from './commands/chat-session.js';
import { listProfiles, addProfile, useProfile, removeProfile } from './commands/profile.js';
import { initProject } from './commands/init-command.js';
import { showConfig } from './utils/config-display.js';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('sc')
  .description('Provider-agnostic CLI agent with tool use')
  .version(packageVersion);

// Chat command (default)
program
  .command('chat', { isDefault: true })
  .description('Start an interactive chat session')
  .argument('[prompt]', 'Optional prompt for non-interactive mode')
  .option('-y, --yes', 'Auto-approve all tool executions (use with caution)')
  .option('-q, --quiet', 'Suppress UI decorations (for non-interactive use)')
  .option('--clear', 'Clear conversation history for this workspace before starting')
  .option('-m, --profile <profile>', 'Model profile to use for this session')
  .option('--permissions <mode>', 'Permissions mode: ask_once, always_ask, or unlimited')
  .action(async (prompt: string | undefined, options) => {
    try {
      let config = await loadConfig(process.cwd());

      // If a profile option is provided, override the active profile in config
      if (options.profile) {
        if (!config.profiles?.[options.profile]) {
          console.error(chalk.red(`Error: Profile "${options.profile}" not found`));
          process.exit(1);
        }
        config.activeProfile = options.profile;
        const profile = config.profiles[options.profile];
        config.model = {
          ...config.model,
          ...profile,
        };
      }

      // Permissions mode mapping
      let permMode: 'ask_once' | 'always_ask' | 'unlimited' | undefined = options.yes ? 'unlimited' : undefined;
      if (options.permissions) {
        if (!['ask_once', 'always_ask', 'unlimited'].includes(options.permissions)) {
          console.error(chalk.red(`Error: Invalid permissions mode. Choose ask_once, always_ask, or unlimited`));
          process.exit(1);
        }
        permMode = options.permissions as 'ask_once' | 'always_ask' | 'unlimited';
      }

      await startChatSession({
        workspaceRoot: process.cwd(),
        config,
        autoApprove: permMode === 'unlimited',
        initialPrompt: prompt,
        quiet: options.quiet,
        clearHistory: options.clear,
        permissionMode: permMode,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${errorMsg}`));
      process.exit(1);
    }
  });

// Profile management
const profileCommand = program.command('profile').description('Manage model profiles');

profileCommand
  .command('list')
  .description('List all available profiles')
  .action(listProfiles);

profileCommand
  .command('add [name]')
  .description('Add a new profile')
  .option('--api-url <url>', 'Base API URL for the provider')
  .option('--model <model>', 'Model identifier')
  .option('--api-key <key>', 'API key for the provider')
  .action(addProfile);

profileCommand
  .command('use [name]')
  .description('Switch to a profile')
  .action(useProfile);

profileCommand
  .command('remove [name]')
  .description('Remove a profile')
  .action(removeProfile);

// Init command
program
  .command('init')
  .description('Initialize a new project with AGENTS.md')
  .action(async () => {
    await initProject(process.cwd());
  });

// Show current configuration
program
  .command('config')
  .description('Show current full configuration')
  .action(async () => {
    try {
      const config = await loadConfig(process.cwd());
      await showConfig(config);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${errorMsg}`));
      process.exit(1);
    }
  });

// Config init
program
  .command('config-init')
  .description('Initialize global config with default profiles')
  .option('-f, --force', 'Overwrite an existing global config file')
  .action(async (options) => {
    try {
      await initConfig(options.force);
      console.log(chalk.green(`✓ Config initialized at ${getGlobalConfigPath()}`));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${errorMsg}`));
      process.exit(1);
    }
  });

program.parse();
