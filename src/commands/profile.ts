import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

type ProfilePromptResponse = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export async function listProfiles(): Promise<void> {
  const config = await loadConfig();
  const profiles = config.profiles || {};

  console.log(chalk.bold('\n📋 Available Profiles:\n'));
  if (Object.keys(profiles).length === 0) {
    console.log(chalk.yellow('  No profiles configured yet.'));
    console.log(chalk.gray('  Run "sc profile add" to create one.\n'));
    return;
  }

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
    console.log(chalk.yellow('Profile creation cancelled: profile name is required.'));
    return;
  }

  if (config.profiles?.[normalizedName]) {
    console.log(chalk.red(`Profile "${normalizedName}" already exists`));
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

  const result = buildProfileFromPromptResponse(response);
  if (!result.profile) {
    console.log(chalk.yellow(`Profile creation cancelled: ${result.error}`));
    return;
  }

  config.profiles = config.profiles || {};
  config.profiles[normalizedName] = result.profile;

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${normalizedName}" added successfully`));
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

  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) {
    console.log(chalk.yellow('Profile switch cancelled: profile name is required.'));
    return;
  }

  if (!config.profiles?.[normalizedName]) {
    console.log(chalk.red(`Profile "${normalizedName}" not found`));
    return;
  }

  config.activeProfile = normalizedName;
  await saveConfig(config, true);
  console.log(chalk.green(`✓ Switched to profile "${normalizedName}"`));
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

  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) {
    console.log(chalk.yellow('Profile removal cancelled: profile name is required.'));
    return;
  }

  if (!config.profiles?.[normalizedName]) {
    console.log(chalk.red(`Profile "${normalizedName}" not found`));
    return;
  }

  delete config.profiles[normalizedName];

  if (config.activeProfile === normalizedName) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${normalizedName}" removed`));
}

export function normalizeProfileName(name?: string): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildProfileFromPromptResponse(
  response: ProfilePromptResponse
): { profile?: Partial<ModelConfig>; error?: string } {
  const baseUrl = response.baseUrl?.trim();
  const model = response.model?.trim();
  const apiKey = response.apiKey?.trim();

  if (!baseUrl) {
    return { error: 'base URL is required.' };
  }

  if (!model) {
    return { error: 'model name is required.' };
  }

  const profile: Partial<ModelConfig> = { baseUrl, model };
  if (apiKey) {
    profile.apiKey = apiKey;
  }

  return { profile };
}
