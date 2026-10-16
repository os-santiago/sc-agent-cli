import prompts from 'prompts';
import chalk from 'chalk';
import { dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { getGlobalConfigPath } from '../../core/config.js';
import { ensureSecureDirSync, writeFileSecureSync } from '../../utils/secure-fs.js';
import type { SlashCommandHandler } from './types.js';

/** `/hud [fields|list]` — toggle the compact status bar and pick its fields. */
export const handleHud: SlashCommandHandler = async (ctx, input) => {
  if (!input.toLowerCase().startsWith('/hud')) return false;
  const hudArgs = input.trim().split(/\s+/);
  const hudSub = hudArgs[1]?.toLowerCase();

  if (hudSub === 'fields') {
    // Interactive field picker
    const current = ctx.hudFields;
    const { ALL_HUD_FIELDS } = await import('../../utils/settings.js');
    const choices = ALL_HUD_FIELDS.map(f => ({
      title: f,
      value: f,
      selected: current.includes(f),
    }));
    const sel = await prompts({
      type: 'multiselect',
      name: 'fields',
      message: 'Select HUD fields to show:',
      choices,
      instructions: false,
    });
    if (sel.fields && sel.fields.length > 0) {
      ctx.hudFields = sel.fields;
      const configPath = getGlobalConfigPath();
      const configDir = dirname(configPath);
      ensureSecureDirSync(configDir);
      let cfg: Record<string, unknown> = {};
      if (existsSync(configPath)) cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (!cfg.settings) cfg.settings = {};
      (cfg.settings as Record<string, unknown>).hudFields = ctx.hudFields;
      writeFileSecureSync(configPath, JSON.stringify(cfg, null, 2));
      console.log(chalk.green(`\n✓ HUD fields: ${ctx.hudFields.join(', ')}\n`));
    } else {
      console.log(chalk.gray('\n  Fields unchanged\n'));
    }
  } else if (hudSub === 'list') {
    console.log(chalk.cyan('\n📊 HUD Configuration'));
    console.log(chalk.gray(`  Enabled: ${ctx.hudEnabled ? 'yes' : 'no'}`));
    console.log(chalk.gray(`  Fields:  ${ctx.hudFields.join(', ')}`));
    console.log(chalk.gray(`  Usage:   /hud          - toggle on/off`));
    console.log(chalk.gray(`           /hud fields    - select which fields to show`));
    console.log(chalk.gray(`           /hud list      - show current HUD config\n`));
  } else {
    // Toggle on/off
    ctx.hudEnabled = !ctx.hudEnabled;
    const configPath = getGlobalConfigPath();
    const configDir = dirname(configPath);
    ensureSecureDirSync(configDir);
    let cfg: Record<string, unknown> = {};
    if (existsSync(configPath)) cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (!cfg.settings) cfg.settings = {};
    (cfg.settings as Record<string, unknown>).hud = ctx.hudEnabled;
    writeFileSecureSync(configPath, JSON.stringify(cfg, null, 2));

    if (ctx.hudEnabled) {
      console.log(chalk.cyan('\n📊 HUD enabled'));
      console.log(chalk.gray(`  Fields: ${ctx.hudFields.join(' | ')}`));
      console.log(chalk.gray('  Set SC_HUD=false to disable via env'));
      console.log(chalk.gray('  Use /hud fields to customize, /hud list for details\n'));
    } else {
      console.log(chalk.yellow('\n📊 HUD disabled'));
      console.log(chalk.gray('  Set SC_HUD=true to re-enable via env'));
      console.log(chalk.gray('  Or use /hud again\n'));
    }
  }
  return true;
};
