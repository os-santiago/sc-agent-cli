import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

function normalizeInput(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function validateNewProfileName(
  name: string | undefined,
  profiles: Record<string, Partial<ModelConfig>>
): string {
  const normalizedName = normalizeInput(name);

  if (!normalizedName) {
    throw new Error('Profile name is required');
  }

  if (profiles[normalizedName]) {
    throw new Error(
      `Profile "${normalizedName}" already exists. Use a different name or remove it first.`
    );
  }

  return normalizedName;
}

export function validateProfileDetails(
  baseUrl?: string,
  model?: string
): { baseUrl: string; model: string } {
  const normalizedBaseUrl = normalizeInput(baseUrl);
  const normalizedModel = normalizeInput(model);

  if (!normalizedBaseUrl) {
    throw new Error('Base URL is required');
  }

  if (!normalizedModel) {
    throw new Error('Model name is required');
  }

  return {
    baseUrl: normalizedBaseUrl,
    model: normalizedModel,
  };
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

  try {
    name = validateNewProfileName(name, config.profiles || {});
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(errorMsg));
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

  if (
    response.baseUrl === undefined
    && response.model === undefined
    && response.apiKey === undefined
  ) {
    console.log(chalk.gray('Cancelled'));
    return;
  }

  let profileDetails: { baseUrl: string; model: string };
  try {
    profileDetails = validateProfileDetails(response.baseUrl, response.model);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(errorMsg));
    return;
  }

  const profile: Partial<ModelConfig> = {
    baseUrl: profileDetails.baseUrl,
    model: profileDetails.model,
  };

  const apiKey = normalizeInput(response.apiKey);
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
