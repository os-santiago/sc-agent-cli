import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

type MissingProfileHelp = {
  suggestion?: string;
  availableProfiles: string[];
};

export function describeMissingProfile(name: string, profiles: string[]): MissingProfileHelp {
  const availableProfiles = [...profiles].sort((left, right) => left.localeCompare(right));
  const suggestion = findClosestProfileName(name, availableProfiles);

  return {
    suggestion,
    availableProfiles,
  };
}

export async function listProfiles(): Promise<void> {
  const config = await loadConfig();
  const profiles = config.profiles || {};
  const profileNames = Object.keys(profiles).sort((left, right) => left.localeCompare(right));

  if (profileNames.length === 0) {
    console.log(chalk.yellow('\nNo profiles configured yet.'));
    console.log(chalk.gray('Run "sc config-init" to install defaults or "sc profile add <name>" to add one.\n'));
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

  if (!name) {
    const profiles = Object.keys(config.profiles || {});
    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles configured yet.'));
      console.log(chalk.gray('Run "sc config-init" to install defaults or "sc profile add <name>" to add one.'));
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
    const help = describeMissingProfile(name, Object.keys(config.profiles || {}));
    console.log(chalk.red(`Profile "${name}" not found.`));
    if (help.suggestion) {
      console.log(chalk.gray(`Did you mean "${help.suggestion}"?`));
    }
    console.log(chalk.gray(`Available profiles: ${help.availableProfiles.join(', ')}`));
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
      console.log(chalk.yellow('No profiles configured yet.'));
      console.log(chalk.gray('Run "sc config-init" to install defaults or "sc profile add <name>" to add one.'));
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
    const help = describeMissingProfile(name, Object.keys(config.profiles || {}));
    console.log(chalk.red(`Profile "${name}" not found.`));
    if (help.suggestion) {
      console.log(chalk.gray(`Did you mean "${help.suggestion}"?`));
    }
    console.log(chalk.gray(`Available profiles: ${help.availableProfiles.join(', ')}`));
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" removed`));
}

function findClosestProfileName(input: string, profiles: string[]): string | undefined {
  const normalizedInput = input.trim().toLowerCase();
  if (!normalizedInput) {
    return undefined;
  }

  const exactPrefixMatch = profiles.find((profile) => profile.toLowerCase().startsWith(normalizedInput));
  if (exactPrefixMatch) {
    return exactPrefixMatch;
  }

  let bestMatch: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const profile of profiles) {
    const distance = levenshteinDistance(normalizedInput, profile.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = profile;
    }
  }

  const maxDistance = Math.max(2, Math.floor(normalizedInput.length / 3));
  return bestDistance <= maxDistance ? bestMatch : undefined;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const temp = previous[column];
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + substitutionCost
      );
      diagonal = temp;
    }
  }

  return previous[right.length];
}
