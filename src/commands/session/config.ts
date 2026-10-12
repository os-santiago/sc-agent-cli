import prompts from 'prompts';
import chalk from 'chalk';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Agent } from '../../core/agent.js';
import { loadConfig, getGlobalConfigPath } from '../../core/config.js';
import { checkStorageLimit, enforceStorageLimit, formatBytes } from '../../utils/storage-limit.js';
import { getStorageGuidance } from '../../utils/storage-guidance.js';
import { ensureSecureDirSync, writeFileSecureSync } from '../../utils/secure-fs.js';
import { redactSecrets } from '../../utils/secret-redaction.js';
import { getModelProfileEmptyStateGuidance } from '../chat-session-guidance.js';
import type { SlashCommandHandler } from './types.js';

/** `/storage` — usage report plus cleanup/tips when over thresholds. */
export const handleStorage: SlashCommandHandler = async (_ctx, input) => {
  if (input.toLowerCase() !== '/storage') return false;
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
      for (const tip of getStorageGuidance()) {
        console.log(chalk.gray(tip));
      }
      console.log();
    } else {
      console.log(chalk.green('✓ Storage usage is healthy\n'));
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
  }
  return true;
};

/** `/reload` — re-read config from disk and re-create the agent. */
export const handleReload: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/reload') return false;
  try {
    console.log(chalk.cyan('\n♻️  Reloading configuration...\n'));

    // Reload config from disk
    const reloadedConfig = await loadConfig(ctx.options.workspaceRoot, { auditLog: ctx.options.auditLog });
    ctx.currentConfig = reloadedConfig;

    // Override with env var if available
    const envApiKey = process.env.SC_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.ANTHROPIC_API_KEY
      || process.env.NVIDIA_API_KEY;
    if (envApiKey) {
      ctx.currentConfig.model.apiKey = envApiKey;
    }

    // Create new agent with reloaded config
    ctx.agent = new Agent({
      ...ctx.options,
      config: ctx.currentConfig,
    });

    console.log(chalk.green('✓ Configuration reloaded successfully!'));
    console.log(chalk.gray(`  Active profile: ${ctx.currentConfig.activeProfile || 'none'}`));
    console.log(chalk.gray(`  Model: ${ctx.currentConfig.model.model}`));
    console.log(chalk.yellow('\n💡 Tip: Conversation history preserved. Use /clear to reset.\n'));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error reloading config: ${redactSecrets(errorMsg)}\n`));
  }
  return true;
};

/** `/model` — switch model profile (optionally saving it as the default). */
export const handleModel: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/model') return false;
  try {
    const config = await loadConfig(ctx.options.workspaceRoot, { auditLog: ctx.options.auditLog });
    const profiles = config.profiles || {};
    const profileNames = Object.keys(profiles);

    if (profileNames.length === 0) {
      console.log();
      getModelProfileEmptyStateGuidance().forEach((line, index) => {
        const color = index === 0 ? chalk.yellow : chalk.gray;
        console.log(color(line));
      });
      console.log();
      return true;
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
      return true;
    }

    // Apply the selected profile
    const selectedProfile = profiles[selection.profile];
    if (!selectedProfile) {
      console.log(chalk.red(`\nProfile "${selection.profile}" not found\n`));
      return true;
    }

    ctx.currentConfig.model = { ...ctx.currentConfig.model, ...selectedProfile };
    ctx.currentConfig.activeProfile = selection.profile;

    // Override with env var if available
    const envApiKey = process.env.SC_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.ANTHROPIC_API_KEY
      || process.env.NVIDIA_API_KEY;
    if (envApiKey) {
      ctx.currentConfig.model.apiKey = envApiKey;
    }

    // Create new agent with updated config
    ctx.agent = new Agent({
      ...ctx.options,
      config: ctx.currentConfig,
    });

    console.log(chalk.green(`\n✓ Switched to: ${selection.profile}`));
    console.log(chalk.gray(`  Model: ${ctx.currentConfig.model.model}`));
    console.log(chalk.gray(`  Provider: ${ctx.currentConfig.model.baseUrl}`));
    console.log(chalk.gray(`  History: ${ctx.history.length} messages preserved for continuity\n`));

    // Ask to save as default for future sessions
    const saveDefault = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Save as default for future sessions?',
      initial: false,
    });

    if (saveDefault.value) {
      try {
        const configPath = getGlobalConfigPath();
        const configDir = dirname(configPath);
        ensureSecureDirSync(configDir);
        let cfg: Record<string, unknown> = {};
        if (existsSync(configPath)) cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        cfg.activeProfile = selection.profile;
        writeFileSecureSync(configPath, JSON.stringify(cfg, null, 2));
        console.log(chalk.gray(`  ✓ Saved "${selection.profile}" as default\n`));
      } catch {
        console.log(chalk.gray(`  ⚠️  Could not save to config\n`));
      }
    } else {
      console.log();
    }

  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error: ${redactSecrets(errorMsg)}\n`));
  }
  return true;
};
