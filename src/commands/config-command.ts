import chalk from 'chalk';
import { loadConfig, getGlobalConfigPath } from '../core/config.js';

export async function showConfig(): Promise<void> {
  const config = await loadConfig(process.cwd());

  console.log(chalk.bold.cyan('\n⚙️  Effective Configuration\n'));
  console.log(chalk.gray('═'.repeat(60)));

  // Global config path
  console.log(chalk.bold('\n📁 Config Sources:'));
  console.log(chalk.gray(`  Global:    ${getGlobalConfigPath()}`));

  // Check for project config
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const projectConfigPath = join(process.cwd(), '.sc-agent.json');
  if (existsSync(projectConfigPath)) {
    console.log(chalk.gray(`  Project:   ${projectConfigPath} ${chalk.green('(active)')}`));
  } else {
    console.log(chalk.gray(`  Project:   ${projectConfigPath} ${chalk.gray('(not found)')}`));
  }

  // Active profile
  console.log(chalk.bold('\n👤 Active Profile:'));
  console.log(chalk.gray(`  ${config.activeProfile || 'none (using defaults)'}`));

  // Model config (with env override indicator)
  console.log(chalk.bold('\n🤖 Model Configuration:'));
  const hasEnvApiKey = !!(process.env.SC_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.NVIDIA_API_KEY);

  console.log(chalk.gray(`  Provider:    ${config.model.provider || 'openai-compatible'}`));
  console.log(chalk.gray(`  Base URL:    ${config.model.baseUrl}`));
  console.log(chalk.gray(`  Model:       ${config.model.model}`));
  console.log(chalk.gray(`  Temperature: ${config.model.temperature ?? 0.7}`));
  console.log(chalk.gray(`  Max Tokens:  ${config.model.maxTokens ?? 4096}`));
  console.log(chalk.gray(`  Stream:      ${config.model.stream ?? true}`));

  if (config.model.apiKey) {
    const maskedKey = config.model.apiKey.length > 8
      ? config.model.apiKey.slice(0, 4) + '****' + config.model.apiKey.slice(-4)
      : '****';
    console.log(chalk.gray(`  API Key:     ${maskedKey} ${hasEnvApiKey ? chalk.yellow('(from env)') : ''}`));
  } else {
    console.log(chalk.gray(`  API Key:     ${chalk.yellow('not set (local model?)')}`));
  }

  // Permissions
  console.log(chalk.bold('\n🔐 Permissions:'));
  const perms = config.permissions;
  if (perms) {
    console.log(chalk.gray(`  Profile:     ${perms.profile || 'traditional'}`));
    if (perms.autoApprove?.length) {
      console.log(chalk.gray(`  Auto-approve: ${perms.autoApprove.join(', ')}`));
    } else {
      console.log(chalk.gray(`  Auto-approve: none`));
    }
    if (perms.denyPaths?.length) {
      console.log(chalk.gray(`  Deny paths:   ${perms.denyPaths.join(', ')}`));
    }
  }

  // All available profiles
  console.log(chalk.bold('\n📋 Available Profiles:'));
  if (config.profiles && Object.keys(config.profiles).length > 0) {
    for (const [name, profile] of Object.entries(config.profiles)) {
      const active = name === config.activeProfile ? chalk.green(' ← active') : '';
      console.log(chalk.gray(`  ${name}${active}`));
      if (profile.baseUrl) console.log(chalk.gray(`    Base URL: ${profile.baseUrl}`));
      if (profile.model) console.log(chalk.gray(`    Model:    ${profile.model}`));
      if (profile.temperature !== undefined) console.log(chalk.gray(`    Temp:     ${profile.temperature}`));
      if (profile.maxTokens !== undefined) console.log(chalk.gray(`    MaxTok:   ${profile.maxTokens}`));
      if (profile.apiKey) {
        const masked = profile.apiKey.length > 8
          ? profile.apiKey.slice(0, 4) + '****' + profile.apiKey.slice(-4)
          : '****';
        console.log(chalk.gray(`    API Key:  ${masked}`));
      }
    }
  } else {
    console.log(chalk.gray('  (none configured)'));
  }

  // Environment variables
  console.log(chalk.bold('\n🌍 Environment Overrides:'));
  const envVars = [
    { key: 'SC_API_KEY', value: process.env.SC_API_KEY },
    { key: 'OPENAI_API_KEY', value: process.env.OPENAI_API_KEY },
    { key: 'ANTHROPIC_API_KEY', value: process.env.ANTHROPIC_API_KEY },
    { key: 'NVIDIA_API_KEY', value: process.env.NVIDIA_API_KEY },
    { key: 'SC_MAX_STORAGE_GB', value: process.env.SC_MAX_STORAGE_GB },
    { key: 'SC_MAX_ITERATIONS', value: process.env.SC_MAX_ITERATIONS },
  ];
  let hasEnv = false;
  for (const { key, value } of envVars) {
    if (value) {
      hasEnv = true;
      const masked = value.length > 8 ? value.slice(0, 4) + '****' + value.slice(-4) : '****';
      console.log(chalk.gray(`  ${key}=${masked}`));
    }
  }
  if (!hasEnv) {
    console.log(chalk.gray('  (none set)'));
  }

  console.log(chalk.gray('\n' + '═'.repeat(60) + '\n'));
}