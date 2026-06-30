import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

type ProfileOperation = 'add' | 'use' | 'remove';

export function normalizeProfileName(name?: string): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

export function formatAvailableProfiles(profileNames: string[]): string {
  if (profileNames.length === 0) {
    return 'No profiles are currently configured.';
  }

  return `Available profiles: ${profileNames.join(', ')}`;
}

export function getMissingProfileMessage(
  operation: Exclude<ProfileOperation, 'add'>,
  name: string,
  profileNames: string[]
): string {
  const action = operation === 'use' ? 'switch to' : 'remove';
  return `Profile "${name}" not found. ${formatAvailableProfiles(profileNames)} Use "sc profile list" to inspect profile settings before you ${action} one.`;
}

export async function listProfiles(): Promise<void> {
  const config = await loadConfig();
  const profiles = config.profiles || {};

  console.log(chalk.bold('\n📋 Available Profiles:\n'));
  for (const [name, profile] of Object.entries(profiles)) {
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

  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) {
    console.log(chalk.gray('Profile creation cancelled'));
    return;
  }

  name = normalizedName;

  if (config.profiles?.[name]) {
    console.log(chalk.red(`Profile "${name}" already exists. Choose a different name or remove it first.`));
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

  const baseUrl = response.baseUrl?.trim();
  const model = response.model?.trim();
  const apiKey = response.apiKey?.trim();

  if (!baseUrl || !model) {
    console.log(chalk.red('Base URL and model name are required. Profile was not saved.'));
    return;
  }

  const profile: Partial<ModelConfig> = {
    baseUrl,
    model,
  };

  if (apiKey) {
    profile.apiKey = apiKey;
  }

  config.profiles = config.profiles || {};
  config.profiles[name] = profile;

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" added successfully`));
}

export async function useProfile(name?: string): Promise<void> {
  const config = await loadConfig();
  const profileNames = Object.keys(config.profiles || {});

  if (!name) {
    if (profileNames.length === 0) {
      console.log(chalk.red('No profiles available'));
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

  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) {
    console.log(chalk.gray('Profile switch cancelled'));
    return;
  }

  name = normalizedName;

  if (!config.profiles?.[name]) {
    console.log(chalk.red(getMissingProfileMessage('use', name, profileNames)));
    return;
  }

  config.activeProfile = name;
  await saveConfig(config, true);
  console.log(chalk.green(`✓ Switched to profile "${name}"`));
}

export async function removeProfile(name?: string): Promise<void> {
  const config = await loadConfig();
  const profileNames = Object.keys(config.profiles || {});

  if (!name) {
    if (profileNames.length === 0) {
      console.log(chalk.red('No profiles available'));
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

  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) {
    console.log(chalk.gray('Profile removal cancelled'));
    return;
  }

  name = normalizedName;

  if (!config.profiles?.[name]) {
    console.log(chalk.red(getMissingProfileMessage('remove', name, profileNames)));
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" removed`));
}
