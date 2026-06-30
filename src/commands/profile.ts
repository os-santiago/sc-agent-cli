import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

function normalizeRequiredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
  let cancelled = false;

  if (!name) {
    const response = await prompts(
      {
        type: 'text',
        name: 'name',
        message: 'Profile name:',
        validate: (value) => normalizeRequiredValue(value) ? true : 'Profile name is required',
      },
      {
        onCancel: () => {
          cancelled = true;
          return false;
        },
      }
    );
    name = normalizeRequiredValue(response.name);
  }

  name = normalizeRequiredValue(name);

  if (cancelled) {
    console.log(chalk.yellow('Profile creation cancelled'));
    return;
  }

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  const response = await prompts(
    [
      {
        type: 'text',
        name: 'baseUrl',
        message: 'Base URL:',
        initial: 'http://localhost:11434/v1',
        validate: (value) => normalizeRequiredValue(value) ? true : 'Base URL is required',
      },
      {
        type: 'text',
        name: 'model',
        message: 'Model name:',
        initial: 'llama3.2',
        validate: (value) => normalizeRequiredValue(value) ? true : 'Model name is required',
      },
      {
        type: 'text',
        name: 'apiKey',
        message: 'API Key (leave empty for local models):',
      },
    ],
    {
      onCancel: () => {
        cancelled = true;
        return false;
      },
    }
  );

  if (cancelled) {
    console.log(chalk.yellow('Profile creation cancelled'));
    return;
  }

  const profile: Partial<ModelConfig> = {
    baseUrl: normalizeRequiredValue(response.baseUrl),
    model: normalizeRequiredValue(response.model),
  };

  if (!profile.baseUrl || !profile.model) {
    console.log(chalk.red('Base URL and model name are required'));
    return;
  }

  const apiKey = normalizeRequiredValue(response.apiKey);
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
