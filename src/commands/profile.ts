import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

type PromptFn = typeof prompts;

export type ProfileCommandDeps = {
  loadConfig: typeof loadConfig;
  saveConfig: typeof saveConfig;
  prompt: PromptFn;
  log: typeof console.log;
};

const defaultDeps: ProfileCommandDeps = {
  loadConfig,
  saveConfig,
  prompt: prompts,
  log: console.log,
};

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
  return addProfileWithDeps(name, defaultDeps);
}

export async function addProfileWithDeps(
  name: string | undefined,
  deps: ProfileCommandDeps
): Promise<void> {
  const config = await deps.loadConfig();

  if (!name) {
    const response = await deps.prompt({
      type: 'text',
      name: 'name',
      message: 'Profile name:',
    });
    name = response.name;
  }

  if (!name) {
    deps.log(chalk.yellow('Profile creation cancelled'));
    return;
  }

  const response = await deps.prompt([
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

  if (!response.baseUrl || !response.model) {
    deps.log(chalk.yellow(`Profile "${name}" was not saved because setup was cancelled`));
    return;
  }

  const profile: Partial<ModelConfig> = {
    baseUrl: response.baseUrl,
    model: response.model,
  };

  if (response.apiKey) {
    profile.apiKey = response.apiKey;
  }

  config.profiles = config.profiles || {};
  config.profiles[name] = profile;

  await deps.saveConfig(config, true);
  deps.log(chalk.green(`✓ Profile "${name}" added successfully`));
}

export async function useProfile(name?: string): Promise<void> {
  return useProfileWithDeps(name, defaultDeps);
}

export async function useProfileWithDeps(
  name: string | undefined,
  deps: ProfileCommandDeps
): Promise<void> {
  const config = await deps.loadConfig();

  if (!name) {
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length === 0) {
      deps.log(chalk.red('No profiles available'));
      return;
    }

    const response = await deps.prompt({
      type: 'select',
      name: 'profile',
      message: 'Select a profile:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });
    name = response.profile;
  }

  if (!name) {
    deps.log(chalk.yellow('Profile switch cancelled'));
    return;
  }

  if (!config.profiles?.[name]) {
    deps.log(chalk.red(`Profile "${name}" not found`));
    return;
  }

  config.activeProfile = name;
  await deps.saveConfig(config, true);
  deps.log(chalk.green(`✓ Switched to profile "${name}"`));
}

export async function removeProfile(name?: string): Promise<void> {
  return removeProfileWithDeps(name, defaultDeps);
}

export async function removeProfileWithDeps(
  name: string | undefined,
  deps: ProfileCommandDeps
): Promise<void> {
  const config = await deps.loadConfig();

  if (!name) {
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length === 0) {
      deps.log(chalk.red('No profiles available'));
      return;
    }

    const response = await deps.prompt({
      type: 'select',
      name: 'profile',
      message: 'Select a profile to remove:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });
    name = response.profile;
  }

  if (!name) {
    deps.log(chalk.yellow('Profile removal cancelled'));
    return;
  }

  if (!config.profiles?.[name]) {
    deps.log(chalk.red(`Profile "${name}" not found`));
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await deps.saveConfig(config, true);
  deps.log(chalk.green(`✓ Profile "${name}" removed`));
}
