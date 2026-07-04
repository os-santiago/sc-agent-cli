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
  .action(async (prompt: string | undefined, options) => {
    try {
      const config = await loadConfig(process.cwd());
      await startChatSession({
        workspaceRoot: process.cwd(),
        config,
        autoApprove: options.yes,
        initialPrompt: prompt,
        quiet: options.quiet,
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
