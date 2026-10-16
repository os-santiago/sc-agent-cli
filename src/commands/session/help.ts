import chalk from 'chalk';
import type { SlashCommandHandler } from './types.js';

/** `/help` — list REPL commands and the built-in tool surface. */
export const handleHelp: SlashCommandHandler = async (_ctx, input) => {
  if (input.toLowerCase() !== '/help') return false;

  console.log(chalk.cyan('\n📖 Available Commands:\n'));
  console.log(chalk.white('  /help                          ') + chalk.gray('- Show this help message'));
  console.log(chalk.white('  /model                         ') + chalk.gray('- Switch to a different model'));
  console.log(chalk.white('  /permissions                   ') + chalk.gray('- Configure permission mode'));
  console.log(chalk.white('  /profile                       ') + chalk.gray('- Switch permission profile (traditional/blacklist)'));
  console.log(chalk.white('  /pre-approved-commands         ') + chalk.gray('- Setup pre-approved commands via interview'));
  console.log(chalk.white('  /storage                       ') + chalk.gray('- Show storage usage and cleanup options'));
  console.log(chalk.white('  /reload                        ') + chalk.gray('- Reload configuration from disk'));
  console.log(chalk.white('  /undo                          ') + chalk.gray('- Undo last exchange (stack-based)'));
  console.log(chalk.white('  /rollback <n>                  ') + chalk.gray('- Rollback to message index <n>'));
  console.log(chalk.white('  /session                       ') + chalk.gray('- Export/import session context'));
  console.log(chalk.white('  /checkpoint                    ') + chalk.gray('- Save/list/resume execution checkpoints'));
  console.log(chalk.white('  /clear                         ') + chalk.gray('- Clear conversation history'));
  console.log(chalk.white('  /memory                        ') + chalk.gray('- View/manage persistent memory'));
  console.log(chalk.white('  /remember [--global] <text>    ') + chalk.gray('- Save a quick memory (workspace or global scope)'));
  console.log(chalk.white('  /config                        ') + chalk.gray('- Show full configuration details'));
  console.log(chalk.white('  /probe                         ') + chalk.gray('- Auto-detect repo toolchain, package manager, and commands'));
  console.log(chalk.white('  /hud                           ') + chalk.gray('- Toggle compact status bar'));
  console.log(chalk.white('  /env                           ') + chalk.gray('- Environment diagnostic (tools, shell, versions)'));
  console.log(chalk.white('  /info                          ') + chalk.gray('- Quick summary'));
  console.log(chalk.white('  exit, quit                     ') + chalk.gray('- End the chat session'));
  console.log(chalk.cyan('\n💡 Tools Available:\n'));
  console.log(chalk.gray('  • read_file     - Read file contents'));
  console.log(chalk.gray('  • write_file    - Create/overwrite files'));
  console.log(chalk.gray('  • edit_file     - Apply diffs to files'));
  console.log(chalk.gray('  • list_dir      - List directory contents'));
  console.log(chalk.gray('  • search_text   - Search text in files'));
  console.log(chalk.gray('  • run_shell     - Execute shell commands'));
  console.log(chalk.gray('  • web_fetch     - Fetch URL content (docs, APIs)'));
  console.log(chalk.gray('  • git           - Native git operations'));
  console.log(chalk.gray('  • repo_probe    - Probe repository toolchains & commands'));
  console.log(chalk.gray('  • memory_*      - Persistent cross-session memory'));
  console.log();
  return true;
};
