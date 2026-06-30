import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

export function buildNoProfilesMessage(action: 'list' | 'use' | 'remove'): string {
  const actionHint = action === 'list'
    ? 'Add one with "sc profile add <name>".'
    : 'Add one with "sc profile add <name>" before trying again.';

  return `No profiles configured. ${actionHint} Restore the default set with "sc config-init --force" if needed.`;
}

export function buildProfileNotFoundMessage(name: string, profileNames: string[]): string {
  if (profileNames.length === 0) {
    return `Profile "${name}" not found. ${buildNoProfilesMessage('use')}`;
  }

  return `Profile "${name}" not found. Available profiles: ${profileNames.join(', ')}. Run "sc profile list" to review them.`;
}

export async function listProfiles(): Promise<void> {
  const config = await loadConfig();
  const profiles = config.profiles || {};
  const profileNames = Object.keys(profiles).sort();

  if (profileNames.length === 0) {
    console.log(chalk.yellow(buildNoProfilesMessage('list')));
    return;
  }

  console.log(chalk.bold('\n📋 Available Profiles:\n'));
  for (const name of profileNames) {
    const profile = profiles[name];
    const active = name === config.activeProfile ? chalk.green(' (active)') : '';
    console.log(chalk.cyan(`  ${name}${active}`));
    console.log(chalk.gray(`    Model: ${profile.model || config.model.model}`));
    console.log(chalk.gray(`    Base URL: ${profile.baseUrl || config.model.baseUrl}`));
  }
  console.log();
}

export async function addProfile(name?: string): Promise<void> {
  const config = await loadConfig();

  if (!name) {
    const response = await prompts({
      type: 'text',
      name: 'name',
      message: 'Profile name:',
    });
    name = response.name;
  }

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  const response = await prompts([
    {
      type: 'text',
      name: 'baseUrl',
      message: 'Base URL:',
      initial: 'http://localhost:11434/v1',
    },
    {
      type: 'text',
      name: 'model',
      message: 'Model name:',
      initial: 'llama3.2',
    },
    {
      type: 'text',
      name: 'apiKey',
      message: 'API Key (leave empty for local models):',
    },
  ]);

  const profile: Partial<ModelConfig> = {
    baseUrl: response.baseUrl,
    model: response.model,
  };

  if (response.apiKey) {
    profile.apiKey = response.apiKey;
  }

  config.profiles = config.profiles || {};
  config.profiles[name] = profile;

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" added successfully`));
}

export async function useProfile(name?: string): Promise<void> {
  const config = await loadConfig();
  const profileNames = Object.keys(config.profiles || {}).sort();

  if (!name) {
    if (profileNames.length === 0) {
      console.log(chalk.red(buildNoProfilesMessage('use')));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile:',
      choices: profileNames.map((p) => ({ title: p, value: p })),
    });
    name = response.profile;
  }

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(buildProfileNotFoundMessage(name, profileNames)));
    return;
  }

  config.activeProfile = name;
  await saveConfig(config, true);
  console.log(chalk.green(`✓ Switched to profile "${name}"`));
}

export async function removeProfile(name?: string): Promise<void> {
  const config = await loadConfig();
  const profileNames = Object.keys(config.profiles || {}).sort();

  if (!name) {
    if (profileNames.length === 0) {
      console.log(chalk.red(buildNoProfilesMessage('remove')));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile to remove:',
      choices: profileNames.map((p) => ({ title: p, value: p })),
    });
    name = response.profile;
  }

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(buildProfileNotFoundMessage(name, profileNames)));
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" removed`));
}
