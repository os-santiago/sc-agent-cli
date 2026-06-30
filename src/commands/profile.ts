import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

export function normalizeProfileInput(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function validateRequiredProfileField(value: string, label: string): true | string {
  return normalizeProfileInput(value) ? true : `${label} is required`;
}

export function validateProfileBaseUrl(value: string): true | string {
  const normalized = normalizeProfileInput(value);

  if (!normalized) {
    return 'Base URL is required';
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Base URL must start with http:// or https://';
    }

    return true;
  } catch {
    return 'Base URL must be a valid http:// or https:// URL';
  }
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
  let profileName = normalizeProfileInput(name);

  if (!profileName) {
    const response = await prompts({
      type: 'text',
      name: 'name',
      message: 'Profile name:',
      validate: (value: string) => validateRequiredProfileField(value, 'Profile name'),
    });
    profileName = normalizeProfileInput(response.name);
  }

  if (!profileName) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  const response = await prompts([
    {
      type: 'text',
      name: 'baseUrl',
      message: 'Base URL:',
      initial: 'http://localhost:11434/v1',
      validate: validateProfileBaseUrl,
    },
    {
      type: 'text',
      name: 'model',
      message: 'Model name:',
      initial: 'llama3.2',
      validate: (value: string) => validateRequiredProfileField(value, 'Model name'),
    },
    {
      type: 'text',
      name: 'apiKey',
      message: 'API Key (leave empty for local models):',
    },
  ]);

  const baseUrl = normalizeProfileInput(response.baseUrl);
  const model = normalizeProfileInput(response.model);
  const apiKey = normalizeProfileInput(response.apiKey);

  const baseUrlValidation = validateProfileBaseUrl(baseUrl);
  if (baseUrlValidation !== true) {
    console.log(chalk.red(baseUrlValidation));
    return;
  }

  const modelValidation = validateRequiredProfileField(model, 'Model name');
  if (modelValidation !== true) {
    console.log(chalk.red(modelValidation));
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
  config.profiles[profileName] = profile;

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${profileName}" added successfully`));
}

export async function useProfile(name?: string): Promise<void> {
  const config = await loadConfig();

  if (!name) {
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length === 0) {
      console.log(chalk.red('No profiles available'));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });
    name = response.profile;
  }

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(`Profile "${name}" not found`));
    return;
  }

  config.activeProfile = name;
  await saveConfig(config, true);
  console.log(chalk.green(`✓ Switched to profile "${name}"`));
}

export async function removeProfile(name?: string): Promise<void> {
  const config = await loadConfig();

  if (!name) {
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length === 0) {
      console.log(chalk.red('No profiles available'));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile to remove:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });
    name = response.profile;
  }

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(`Profile "${name}" not found`));
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" removed`));
}
