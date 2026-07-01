import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

const PROFILE_ADD_HINT = 'Run "sc profile add <name>" to create one.';
const PROFILE_LIST_HINT = 'Run "sc profile list" to see available profiles.';

export function normalizeProfileName(name?: string): string | undefined {
  const normalized = name?.trim();
  return normalized ? normalized : undefined;
}

export function buildMissingProfileMessage(name: string, availableProfiles: string[]): string {
  const guidance = availableProfiles.length > 0
    ? PROFILE_LIST_HINT
    : PROFILE_ADD_HINT;

  return `Profile "${name}" not found. ${guidance}`;
}

export function buildDuplicateProfileMessage(name: string): string {
  return `Profile "${name}" already exists. Use "sc profile use ${name}" to switch to it or ` +
    `"sc profile remove ${name}" before recreating it.`;
}

export async function listProfiles(): Promise<void> {
  const config = await loadConfig();
  const profiles = config.profiles || {};

  console.log(chalk.bold('\n📋 Available Profiles:\n'));
  if (Object.keys(profiles).length === 0) {
    console.log(chalk.yellow(`  No saved profiles yet. ${PROFILE_ADD_HINT}`));
    console.log();
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
    name = normalizeProfileName(response.name);
  }

  name = normalizeProfileName(name);

  if (!name) {
    console.log(chalk.red(`Profile name is required. ${PROFILE_ADD_HINT}`));
    return;
  }

  if (config.profiles?.[name]) {
    console.log(chalk.red(buildDuplicateProfileMessage(name)));
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
  const profiles = Object.keys(config.profiles || {});

  if (!name) {
    if (profiles.length === 0) {
      console.log(chalk.red(`No profiles available. ${PROFILE_ADD_HINT}`));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });
    name = normalizeProfileName(response.profile);
  }

  name = normalizeProfileName(name);

  if (!name) {
    console.log(chalk.red(`Profile name is required. ${PROFILE_LIST_HINT}`));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(buildMissingProfileMessage(name, profiles)));
    return;
  }

  config.activeProfile = name;
  await saveConfig(config, true);
  console.log(chalk.green(`✓ Switched to profile "${name}"`));
}

export async function removeProfile(name?: string): Promise<void> {
  const config = await loadConfig();
  const profiles = Object.keys(config.profiles || {});

  if (!name) {
    if (profiles.length === 0) {
      console.log(chalk.red(`No profiles available. ${PROFILE_ADD_HINT}`));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'profile',
      message: 'Select a profile to remove:',
      choices: profiles.map((p) => ({ title: p, value: p })),
    });
    name = normalizeProfileName(response.profile);
  }

  name = normalizeProfileName(name);

  if (!name) {
    console.log(chalk.red(`Profile name is required. ${PROFILE_LIST_HINT}`));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(buildMissingProfileMessage(name, profiles)));
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" removed`));
}
