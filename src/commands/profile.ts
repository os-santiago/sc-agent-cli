import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

function formatProfileNames(names: string[]): string {
  return names.join(', ');
}

export async function listProfiles(): Promise<void> {
  const config = await loadConfig();
  const profiles = config.profiles || {};
  const profileEntries = Object.entries(profiles);

  console.log(chalk.bold('\n📋 Available Profiles:\n'));

  if (profileEntries.length === 0) {
    console.log(chalk.yellow('  No profiles configured yet.'));
    console.log(chalk.gray('  Run "sc profile add <name>" to create one.\n'));
    return;
  }

  for (const [name, profile] of profileEntries) {
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

    if (response.name === undefined) {
      console.log(chalk.gray('Profile creation cancelled'));
      return;
    }

    name = response.name;
  }

  name = name?.trim();

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

  if (!name) {
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles available'));
      console.log(chalk.gray('Run "sc profile add <name>" to create one first.'));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });

    if (response.profile === undefined) {
      console.log(chalk.gray('Profile switch cancelled'));
      return;
    }

    name = response.profile;
  }

  name = name?.trim();

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(`Profile "${name}" not found`));
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length > 0) {
      console.log(chalk.gray(`Available profiles: ${formatProfileNames(profiles)}`));
    }
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
      console.log(chalk.yellow('No profiles available'));
      console.log(chalk.gray('Run "sc profile add <name>" to create one first.'));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile to remove:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });

    if (response.profile === undefined) {
      console.log(chalk.gray('Profile removal cancelled'));
      return;
    }

    name = response.profile;
  }

  name = name?.trim();

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(`Profile "${name}" not found`));
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length > 0) {
      console.log(chalk.gray(`Available profiles: ${formatProfileNames(profiles)}`));
    }
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" removed`));
}
