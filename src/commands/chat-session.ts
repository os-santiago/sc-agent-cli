import prompts from 'prompts';
import chalk from 'chalk';
import * as readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../core/agent.js';
import type { AgentOptions } from '../core/agent.js';
import type { Message } from '../core/types.js';
import { loadConfig } from '../core/config.js';
import { clearSessionPermissions } from '../utils/permissions.js';
import { checkStorageLimit, enforceStorageLimit, formatBytes } from '../utils/storage-limit.js';
import { statusBar, getShortcutsBar } from '../utils/status-bar.js';
import { createCompleter } from '../utils/autocomplete.js';

export function getModelProfileEmptyStateGuidance(commandName = 'sc'): string[] {
  return [
    'No model profiles available.',
    `Run \`${commandName} profile add <name>\` to create one.`,
    `Run \`${commandName} config-init\` to restore the default profiles.`,
  ];
}

// Helper to read user input with history navigation and autocomplete
function readUserInput(history: string[], workspaceRoot: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input,
      output,
      history,
      historySize: 100,
      prompt: chalk.bold.blue('│ '),
      completer: createCompleter(workspaceRoot),
    });

    rl.question('', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function startChatSession(options: AgentOptions): Promise<void> {
  let agent = new Agent(options);
  let history: Message[] = [];
  let currentConfig = options.config;
  let inputHistory: string[] = [];
  let currentPermissionMode: 'ask_once' | 'always_ask' | 'unlimited' = options.autoApprove ? 'unlimited' : 'ask_once';

  // Check storage limit on startup
  const configDir = join(homedir(), '.sc-agent');
  const storageInfo = checkStorageLimit(configDir);

  // Non-interactive mode: skip UI decorations if quiet flag is set
  const isQuiet = options.quiet || false;
  const isNonInteractive = Boolean(options.initialPrompt);

  if (!isQuiet) {
    console.log(chalk.gray('╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('  🤖 SC-Agent CLI'));
    console.log(chalk.gray('╠════════════════════════════════════════════════════════════╣'));
    console.log(chalk.gray(`  Workspace: ${options.workspaceRoot}`));
    console.log(chalk.gray(`  Model:     ${currentConfig.model.model}`));
    console.log(chalk.gray(`  Provider:  ${currentConfig.model.baseUrl}`));
    console.log(chalk.gray(`  Storage:   ${formatBytes(storageInfo.currentSize)} / ${formatBytes(storageInfo.maxSize)} (${storageInfo.usagePercent.toFixed(1)}%)`));
    console.log(chalk.gray('╠════════════════════════════════════════════════════════════╣'));
    if (!isNonInteractive) {
      console.log(chalk.gray('  Type "exit" or "quit" to end the session'));
      console.log(chalk.gray('  Type "/help" for available commands'));
    }
    console.log(chalk.gray('╚════════════════════════════════════════════════════════════╝\n'));

    // Warn if storage is getting high
    if (storageInfo.usagePercent > 80 && !storageInfo.needsCleanup) {
      console.log(chalk.yellow(`⚠️  Storage usage is at ${storageInfo.usagePercent.toFixed(1)}%`));
      console.log(chalk.gray(`   Consider increasing SC_MAX_STORAGE_GB or cleaning old files\n`));
    }
  }

  // Auto-cleanup if over limit
  if (storageInfo.needsCleanup) {
    enforceStorageLimit(configDir, true);
  }

  // Show status bar at bottom (only in interactive mode)
  if (!isNonInteractive && !isQuiet) {
    statusBar.show(getShortcutsBar());
  }

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    if (!isQuiet) {
      statusBar.hide();
      console.log(chalk.gray('\n\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('  👋 Goodbye!'));
      console.log(chalk.gray('╚════════════════════════════════════════════════════════════╝\n'));
    }
    process.exit(0);
  });

  // Non-interactive mode: process single prompt and exit
  if (isNonInteractive && options.initialPrompt) {
    const userInput = options.initialPrompt;

    if (!isQuiet) {
      console.log(chalk.blue('\n┌─ Prompt ──────────────────────────────────────────────────┐'));
      console.log(chalk.gray(`│ ${userInput}`));
      console.log(chalk.blue('└───────────────────────────────────────────────────────────┘'));
    }

    // Process the prompt
    console.log(chalk.gray('\n┌─ Assistant ───────────────────────────────────────────────┐'));
    const response = await agent.run(userInput, history);
    console.log(chalk.gray('└───────────────────────────────────────────────────────────┘\n'));

    // Exit after processing
    return;
  }

  // Interactive mode loop
  while (true) {
    // Show status bar before each input
    if (!isQuiet) {
      statusBar.show(getShortcutsBar());
    }

    // User input separator
    if (!isQuiet) {
      console.log(chalk.blue('\n┌─ You ─────────────────────────────────────────────────────┐'));
    }
    const userInput = await readUserInput(inputHistory, options.workspaceRoot);
    if (!isQuiet) {
      console.log(chalk.blue('└───────────────────────────────────────────────────────────┘'));
    }

    // Hide status bar while processing
    if (!isQuiet) {
      statusBar.hide();
    }

    if (!userInput) {
      continue;
    }

    // Add to input history (but not commands)
    if (!userInput.startsWith('/') && userInput.toLowerCase() !== 'exit' && userInput.toLowerCase() !== 'quit') {
      inputHistory.push(userInput);
    }

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      statusBar.hide();
      console.log(chalk.gray('\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('  👋 Goodbye!'));
      console.log(chalk.gray('╚════════════════════════════════════════════════════════════╝\n'));
      break;
    }

    // Handle /help command
    if (userInput.toLowerCase() === '/help') {
      console.log(chalk.cyan('\n📖 Available Commands:\n'));
      console.log(chalk.white('  /help                          ') + chalk.gray('- Show this help message'));
      console.log(chalk.white('  /model                         ') + chalk.gray('- Switch to a different model'));
      console.log(chalk.white('  /permissions                   ') + chalk.gray('- Configure permission mode'));
      console.log(chalk.white('  /profile                       ') + chalk.gray('- Switch permission profile (traditional/blacklist)'));
      console.log(chalk.white('  /pre-approved-commands         ') + chalk.gray('- Setup pre-approved commands via interview'));
      console.log(chalk.white('  /storage                       ') + chalk.gray('- Show storage usage and cleanup options'));
      console.log(chalk.white('  /reload                        ') + chalk.gray('- Reload configuration from disk'));
      console.log(chalk.white('  /clear                         ') + chalk.gray('- Clear conversation history'));
      console.log(chalk.white('  /info                          ') + chalk.gray('- Show current model and config'));
      console.log(chalk.white('  exit, quit                     ') + chalk.gray('- End the chat session'));
      console.log(chalk.cyan('\n💡 Tools Available:\n'));
      console.log(chalk.gray('  • read_file     - Read file contents'));
      console.log(chalk.gray('  • write_file    - Create/overwrite files'));
      console.log(chalk.gray('  • edit_file     - Apply diffs to files'));
      console.log(chalk.gray('  • list_dir      - List directory contents'));
      console.log(chalk.gray('  • search_text   - Search text in files'));
      console.log(chalk.gray('  • run_shell     - Execute shell commands'));
      console.log();
      continue;
    }

    // Handle /clear command
    if (userInput.toLowerCase() === '/clear') {
      history = [];
      console.log(chalk.green('\n✓ Conversation history cleared\n'));
      continue;
    }

    // Handle /permissions command
    if (userInput.toLowerCase() === '/permissions') {
      try {
        const permissionMode = await prompts({
          type: 'select',
          name: 'mode',
          message: 'Select permission mode:',
          choices: [
            {
              title: 'Ask once per command (recommended)',
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
          ],
          initial: 0,
        });

        if (!permissionMode.mode) {
          console.log(chalk.gray('\nCancelled\n'));
          continue;
        }

        // Update agent with new permission mode
        const selectedMode = permissionMode.mode as 'ask_once' | 'always_ask' | 'unlimited';
        currentPermissionMode = selectedMode;

        if (selectedMode === 'unlimited') {
          agent = new Agent({
            ...options,
            config: currentConfig,
            autoApprove: true,
          });
          console.log(chalk.yellow('\n⚠️  Permission mode: Unlimited (dangerous)'));
          console.log(chalk.gray('   All tools will auto-approve without asking'));
          console.log(chalk.gray('   Use with caution!\n'));
        } else if (selectedMode === 'always_ask') {
          // Clear any session permissions when switching to always ask
          clearSessionPermissions();
          agent = new Agent({
            ...options,
            config: currentConfig,
            autoApprove: false,
          });
          console.log(chalk.green('\n✓ Permission mode: Always ask (safer)'));
          console.log(chalk.gray('   You will be prompted for every tool use\n'));
        } else {
          // ask_once - default behavior with session tracking
          agent = new Agent({
            ...options,
            config: currentConfig,
            autoApprove: false,
          });
          console.log(chalk.cyan('\n✓ Permission mode: Ask once per command (recommended)'));
          console.log(chalk.gray('   First use prompts, then auto-approves for session\n'));
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
      }
      continue;
    }

    // Handle /profile command
    if (userInput.toLowerCase() === '/profile') {
      try {
        const currentProfile = currentConfig.permissions?.profile || 'traditional';

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
          continue;
        }

        // Save to config
        try {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { homedir } = await import('node:os');

          const configPath = path.join(homedir(), '.sc-agent', 'config.json');
          const configDir = path.dirname(configPath);

          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
          }

          let config: any = {};
          if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf-8');
            config = JSON.parse(configContent);
          }

          if (!config.permissions) {
            config.permissions = {};
          }
          config.permissions.profile = profileChoice.profile;

          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

          // Update current config
          if (!currentConfig.permissions) {
            currentConfig.permissions = {};
          }
          currentConfig.permissions.profile = profileChoice.profile;

          // Recreate agent with new config
          agent = new Agent({
            ...options,
            config: currentConfig,
            autoApprove: currentPermissionMode === 'unlimited',
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
      continue;
    }

    // Handle /pre-approved-commands command
    if (userInput.toLowerCase() === '/pre-approved-commands' || userInput.toLowerCase() === '/pre-approved-commands-interview') {
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
          message: `Allow writing/editing files in this directory (${options.workspaceRoot})?`,
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
            const fs = await import('node:fs');
            const path = await import('node:path');
            const { homedir } = await import('node:os');

            const configPath = path.join(homedir(), '.sc-agent', 'config.json');

            // Ensure directory exists
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
              fs.mkdirSync(configDir, { recursive: true });
            }

            // Read existing config or create new
            let config: any = {};
            if (fs.existsSync(configPath)) {
              const configContent = fs.readFileSync(configPath, 'utf-8');
              config = JSON.parse(configContent);
            }

            // Update permissions
            if (!config.permissions) {
              config.permissions = {};
            }
            config.permissions.autoApprove = preApprovedTools;

            // Write config
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            console.log(chalk.green('\n✓ Configuration saved to:'));
            console.log(chalk.gray(`  ${configPath}\n`));

            // Reload config
            const reloadedConfig = await loadConfig(options.workspaceRoot);
            currentConfig = reloadedConfig;

            agent = new Agent({
              ...options,
              config: currentConfig,
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
      continue;
    }

    // Handle /storage command
    if (userInput.toLowerCase() === '/storage') {
      try {
        const configDir = join(homedir(), '.sc-agent');
        const info = checkStorageLimit(configDir);

        console.log(chalk.cyan('\n💾 Storage Usage:\n'));
        console.log(chalk.white('  Current:   ') + chalk.gray(formatBytes(info.currentSize)));
        console.log(chalk.white('  Limit:     ') + chalk.gray(formatBytes(info.maxSize)));
        console.log(chalk.white('  Usage:     ') + (
          info.usagePercent > 90 ? chalk.red(`${info.usagePercent.toFixed(1)}%`) :
          info.usagePercent > 80 ? chalk.yellow(`${info.usagePercent.toFixed(1)}%`) :
          chalk.green(`${info.usagePercent.toFixed(1)}%`)
        ));
        console.log(chalk.white('  Directory: ') + chalk.gray(configDir));
        console.log();

        if (info.needsCleanup) {
          console.log(chalk.red('⚠️  Storage limit exceeded!\n'));

          const cleanup = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Clean up old files now?',
            initial: true,
          });

          if (cleanup.value) {
            enforceStorageLimit(configDir, true);
          }
        } else if (info.usagePercent > 80) {
          console.log(chalk.yellow('💡 Tips:\n'));
          console.log(chalk.gray('  • Increase limit: export SC_MAX_STORAGE_GB=2'));
          console.log(chalk.gray('  • Clean manually: rm -rf ~/.sc-agent/old-files'));
          console.log(chalk.gray('  • Auto-cleanup runs when limit is exceeded\n'));
        } else {
          console.log(chalk.green('✓ Storage usage is healthy\n'));
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
      }
      continue;
    }

    // Handle /reload command
    if (userInput.toLowerCase() === '/reload') {
      try {
        console.log(chalk.cyan('\n♻️  Reloading configuration...\n'));

        // Reload config from disk
        const reloadedConfig = await loadConfig(options.workspaceRoot);
        currentConfig = reloadedConfig;

        // Override with env var if available
        const envApiKey = process.env.SC_API_KEY
          || process.env.OPENAI_API_KEY
          || process.env.ANTHROPIC_API_KEY
          || process.env.NVIDIA_API_KEY;
        if (envApiKey) {
          currentConfig.model.apiKey = envApiKey;
        }

        // Create new agent with reloaded config
        agent = new Agent({
          ...options,
          config: currentConfig,
        });

        console.log(chalk.green('✓ Configuration reloaded successfully!'));
        console.log(chalk.gray(`  Active profile: ${currentConfig.activeProfile || 'none'}`));
        console.log(chalk.gray(`  Model: ${currentConfig.model.model}`));
        console.log(chalk.yellow('\n💡 Tip: Conversation history preserved. Use /clear to reset.\n'));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\n✗ Error reloading config: ${errorMsg}\n`));
      }
      continue;
    }

    // Handle /info command
    if (userInput.toLowerCase() === '/info') {
      console.log(chalk.cyan('\n📊 Current Configuration:\n'));
      console.log(chalk.white('  Profile:     ') + chalk.green(currentConfig.activeProfile || 'none'));
      console.log(chalk.white('  Model:       ') + chalk.gray(currentConfig.model.model));
      console.log(chalk.white('  Provider:    ') + chalk.gray(currentConfig.model.baseUrl));
      console.log(chalk.white('  Temperature: ') + chalk.gray(`${currentConfig.model.temperature ?? 0.7}`));
      console.log(chalk.white('  Max Tokens:  ') + chalk.gray(`${currentConfig.model.maxTokens ?? 4096}`));
      console.log(chalk.white('  Permissions: ') + (
        currentPermissionMode === 'unlimited' ? chalk.yellow('Unlimited (dangerous)') :
        currentPermissionMode === 'always_ask' ? chalk.green('Always ask (safer)') :
        chalk.cyan('Ask once per command')
      ));

      // Show permission profile
      const permProfile = currentConfig.permissions?.profile || 'traditional';
      console.log(chalk.white('  Profile:     ') + (
        permProfile === 'blacklist' ? chalk.cyan('Blacklist (smart)') :
        chalk.gray('Traditional')
      ));

      // Show auto-approved tools
      const autoApproveList = currentConfig.permissions?.autoApprove || [];
      if (autoApproveList.length > 0) {
        console.log(chalk.white('  Auto-approve:') + chalk.gray(` ${autoApproveList.join(', ')}`));
      }

      console.log(chalk.white('  History:     ') + chalk.gray(`${history.length} messages`));
      console.log();
      continue;
    }

    // Handle /model command
    if (userInput.toLowerCase() === '/model') {
      try {
        const config = await loadConfig(options.workspaceRoot);
        const profiles = config.profiles || {};
        const profileNames = Object.keys(profiles);

        if (profileNames.length === 0) {
          const [headline, ...nextSteps] = getModelProfileEmptyStateGuidance();
          console.log(chalk.yellow(`\n${headline}`));
          nextSteps.forEach((line) => {
            console.log(chalk.gray(`  ${line}`));
          });
          console.log();
          continue;
        }

        const choices = profileNames.map((name) => ({
          title: `${name}${name === config.activeProfile ? ' (current)' : ''} - ${profiles[name]?.model || 'unknown'}`,
          value: name,
        }));

        const selection = await prompts({
          type: 'select',
          name: 'profile',
          message: 'Select a model profile:',
          choices,
        });

        if (!selection.profile) {
          console.log(chalk.gray('\nCancelled\n'));
          continue;
        }

        // Apply the selected profile
        const selectedProfile = profiles[selection.profile];
        if (!selectedProfile) {
          console.log(chalk.red(`\nProfile "${selection.profile}" not found\n`));
          continue;
        }

        currentConfig.model = { ...currentConfig.model, ...selectedProfile };
        currentConfig.activeProfile = selection.profile;

        // Override with env var if available
        const envApiKey = process.env.SC_API_KEY
          || process.env.OPENAI_API_KEY
          || process.env.ANTHROPIC_API_KEY
          || process.env.NVIDIA_API_KEY;
        if (envApiKey) {
          currentConfig.model.apiKey = envApiKey;
        }

        // Create new agent with updated config
        agent = new Agent({
          ...options,
          config: currentConfig,
        });

        console.log(chalk.green(`\n✓ Switched to: ${selection.profile}`));
        console.log(chalk.gray(`  Model: ${currentConfig.model.model}`));
        console.log(chalk.gray(`  Provider: ${currentConfig.model.baseUrl}\n`));

        // Clear history when switching models
        history = [];
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
      }
      continue;
    }

    try {
      console.log(chalk.green('\n┌─ Assistant ───────────────────────────────────────────────┐'));
      history = await agent.run(userInput, history);
      console.log(chalk.green('\n└───────────────────────────────────────────────────────────┘\n'));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
    }
  }
}
