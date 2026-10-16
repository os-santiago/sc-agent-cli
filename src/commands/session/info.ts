import chalk from 'chalk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getGlobalConfigPath } from '../../core/config.js';
import { showConfig } from '../../utils/config-display.js';
import type { SlashCommandHandler } from './types.js';

/** `/env` — environment diagnostic: shell, tools, storage, workspace, config. */
export const handleEnv: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/env') return false;
  try {
    const { detectShell } = await import('../../utils/shell-env.js');
    const shellInfo = detectShell();
    const { checkStorageLimit, formatBytes } = await import('../../utils/storage-limit.js');
    const storageInfo = checkStorageLimit(join(homedir(), '.sc-agent'));

    console.log(chalk.cyan('\n🔍 Environment Diagnostic'));
    console.log(chalk.gray('═'.repeat(50)));

    console.log(chalk.gray('\n📋 Shell'));
    console.log(chalk.gray(`  Type:     ${shellInfo.type}`));
    console.log(chalk.gray(`  Platform: ${process.platform}`));
    console.log(chalk.gray(`  Arch:     ${process.arch}`));
    console.log(chalk.gray(`  Node:     ${process.version}`));

    console.log(chalk.gray('\n🔧 Tools'));
    const tools = shellInfo.tools;
    for (const [name, available] of Object.entries(tools)) {
      const icon = available ? chalk.green('✓') : chalk.red('✗');
      console.log(chalk.gray(`  ${icon} ${name}`));
    }

    console.log(chalk.gray('\n💾 Storage'));
    console.log(chalk.gray(`  ${formatBytes(storageInfo.currentSize)} / ${formatBytes(storageInfo.maxSize)} (${storageInfo.usagePercent.toFixed(1)}%)`));

    console.log(chalk.gray('\n📂 Workspace'));
    console.log(chalk.gray(`  ${ctx.options.workspaceRoot}`));

    console.log(chalk.gray('\n🌐 Config'));
    console.log(chalk.gray(`  ${getGlobalConfigPath()}`));
    console.log(chalk.gray(`  Active profile: ${ctx.currentConfig.activeProfile || 'none'}`));
    console.log(chalk.gray(`  Model: ${ctx.currentConfig.model.model}`));
    console.log();
  } catch {
    console.log(chalk.red('\n⚠️  Environment diagnostic failed\n'));
  }
  return true;
};

/** `/probe` (alias `/repo`) — auto-detect repo toolchain and commands. */
export const handleProbe: SlashCommandHandler = async (ctx, input) => {
  const lower = input.toLowerCase();
  if (!lower.startsWith('/probe') && !lower.startsWith('/repo')) return false;
  try {
    const { probeRepo, formatRepoProfileForTerminal, formatRepoProfileJSON } = await import('../../core/repo-probe/index.js');
    const isJson = input.includes('--json') || input.includes(' json');
    const isRefresh = input.includes('--refresh') || input.includes(' refresh') || input.includes('--no-cache');
    const profile = await probeRepo(ctx.options.workspaceRoot, {
      forceRefresh: isRefresh,
      useCache: !isRefresh,
    });
    if (isJson) {
      console.log(formatRepoProfileJSON(profile));
    } else {
      console.log(formatRepoProfileForTerminal(profile));
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Probe failed: ${errorMsg}\n`));
  }
  return true;
};

/** `/config` — comprehensive configuration view. */
export const handleConfig: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/config') return false;
  await showConfig(ctx.currentConfig, {
    permissionMode: ctx.currentPermissionMode,
    historyLength: ctx.history.length,
  });
  return true;
};

/** `/info` — short session summary. */
export const handleInfo: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/info') return false;
  console.log(chalk.cyan('\n📋 Quick Info:\n'));
  console.log(chalk.white('  Profile:     ') + chalk.green(ctx.currentConfig.activeProfile || 'none'));
  console.log(chalk.white('  Model:       ') + chalk.gray(ctx.currentConfig.model.model));
  console.log(chalk.white('  Provider:    ') + chalk.gray(ctx.currentConfig.model.baseUrl));
  console.log(chalk.white('  Permissions: ') + (
    ctx.currentPermissionMode === 'unlimited' ? chalk.yellow('Unlimited') :
    ctx.currentPermissionMode === 'always_ask' ? chalk.green('Always ask') :
    chalk.cyan('Ask once')
  ));
  console.log(chalk.white('  History:     ') + chalk.gray(`${ctx.history.length} messages`));
  console.log(chalk.white('  Tools:       ') + chalk.gray('10 available (see /config for details)'));
  console.log();
  return true;
};
