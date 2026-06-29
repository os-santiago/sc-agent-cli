import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

async function promptForProfileName(name?: string): Promise<string | undefined> {
  if (name) {
    return name;
  }

  const response = await prompts({
    type: 'text',
    name: 'name',
    message: 'Profile name:',
  });

  return response.name;
}

async function promptForProfileConfig(existingProfile?: Partial<ModelConfig>): Promise<Partial<ModelConfig>> {
  const response = await prompts([
    {
      type: 'text',
      name: 'baseUrl',
      message: 'Base URL:',
      initial: existingProfile?.baseUrl || 'http://localhost:11434/v1',
    },
    {
      type: 'text',
      name: 'model',
      message: 'Model name:',
      initial: existingProfile?.model || 'llama3.2',
    },
    {
      type: 'text',
      name: 'apiKey',
      message: 'API Key (leave empty for local models):',
      initial: existingProfile?.apiKey,
    },
  ]);

  const profile: Partial<ModelConfig> = {
    baseUrl: response.baseUrl,
    model: response.model,
  };

  if (response.apiKey) {
    profile.apiKey = response.apiKey;
  }

  return profile;
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
  name = await promptForProfileName(name);

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (config.profiles?.[name]) {
    console.log(chalk.red(`Profile "${name}" already exists`));
    console.log(chalk.gray(`Use "sc profile add ${name} --force" to overwrite it.`));
    console.log(chalk.gray(`Or run "sc profile use ${name}" to switch to it.`));
    return;
  }

  const profile = await promptForProfileConfig();

  config.profiles = config.profiles || {};
  config.profiles[name] = profile;

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" added successfully`));
}

export async function addOrReplaceProfile(name?: string): Promise<void> {
  const config = await loadConfig();
  name = await promptForProfileName(name);

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  const replacingExisting = Boolean(config.profiles?.[name]);
  const profile = await promptForProfileConfig(config.profiles?.[name]);

  config.profiles = config.profiles || {};
  config.profiles[name] = profile;

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" ${replacingExisting ? 'updated' : 'added'} successfully`));
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
