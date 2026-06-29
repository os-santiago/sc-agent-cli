import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig, saveConfig } from '../core/config.js';
import type { ModelConfig } from '../core/types.js';

type ProfileAction = 'use' | 'remove';

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

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(formatMissingProfileMessage(name, profileNames, 'use')));
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

  if (!name) {
    console.log(chalk.red('Profile name is required'));
    return;
  }

  if (!config.profiles?.[name]) {
    console.log(chalk.red(formatMissingProfileMessage(name, profileNames, 'remove')));
    return;
  }

  delete config.profiles[name];

  if (config.activeProfile === name) {
    config.activeProfile = undefined;
  }

  await saveConfig(config, true);
  console.log(chalk.green(`✓ Profile "${name}" removed`));
}

export function formatMissingProfileMessage(
  name: string,
  availableProfiles: string[],
  action: ProfileAction
): string {
  const suggestion = findClosestProfileName(name, availableProfiles);
  const availableList = availableProfiles.join(', ');
  const nextStep = action === 'use' ? 'sc profile use <name>' : 'sc profile remove <name>';

  if (suggestion) {
    return `Profile "${name}" not found. Did you mean "${suggestion}"? Available profiles: ${availableList}. Run "${nextStep}" or "sc profile list" for details.`;
  }

  return `Profile "${name}" not found. Available profiles: ${availableList}. Run "${nextStep}" or "sc profile list" for details.`;
}

export function findClosestProfileName(name: string, availableProfiles: string[]): string | undefined {
  const normalizedName = name.toLowerCase();
  let bestMatch: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of availableProfiles) {
    const normalizedCandidate = candidate.toLowerCase();

    if (
      normalizedCandidate.startsWith(normalizedName) ||
      normalizedName.startsWith(normalizedCandidate)
    ) {
      return candidate;
    }

    const distance = levenshteinDistance(normalizedName, normalizedCandidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  return bestDistance <= 3 ? bestMatch : undefined;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 0; i < left.length; i += 1) {
    let previousDiagonal = previousRow[0];
    previousRow[0] = i + 1;

    for (let j = 0; j < right.length; j += 1) {
      const temp = previousRow[j + 1];
      const substitutionCost = left[i] === right[j] ? 0 : 1;

      previousRow[j + 1] = Math.min(
        previousRow[j + 1] + 1,
        previousRow[j] + 1,
        previousDiagonal + substitutionCost
      );

      previousDiagonal = temp;
    }
  }

  return previousRow[right.length];
}
