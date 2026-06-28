import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import prompts from 'prompts';

const DEFAULT_AGENTS_MD = `# Agent Instructions

This file provides context to the SC-Agent when working in this project.

## Project Overview

[Describe your project here]

## Key Files and Structure

[Explain important directories and files]

## Coding Guidelines

[List any coding standards, patterns, or preferences]

## Build and Test

[Explain how to build and test the project]
`;

export interface InitProjectOptions {
  force?: boolean;
  confirmOverwrite?: (agentsPath: string) => Promise<boolean>;
}

async function confirmOverwritePrompt(agentsPath: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(chalk.yellow(`⚠ AGENTS.md already exists at ${agentsPath}`));
    console.log(chalk.gray('  Re-run with --force to overwrite it.\n'));
    return false;
  }

  const response = await prompts({
    type: 'confirm',
    name: 'overwrite',
    message: `AGENTS.md already exists at ${agentsPath}. Overwrite it?`,
    initial: false,
  });

  return response.overwrite === true;
}

export async function initProject(cwd: string, options: InitProjectOptions = {}): Promise<void> {
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const confirmOverwrite = options.confirmOverwrite || confirmOverwritePrompt;
  let willOverwrite = false;

  try {
    await access(agentsPath);
    willOverwrite = true;

    if (!options.force) {
      const shouldOverwrite = await confirmOverwrite(agentsPath);
      if (!shouldOverwrite) {
        console.log(chalk.gray('Skipped creating AGENTS.md\n'));
        return;
      }
    }
  } catch {
    // File does not exist yet; continue.
  }

  try {
    await writeFile(agentsPath, DEFAULT_AGENTS_MD, 'utf-8');
    const action = willOverwrite ? 'Overwrote' : 'Created';
    console.log(chalk.green(`✓ ${action} ${agentsPath}`));
    console.log(chalk.gray('  Edit this file to provide context for the agent'));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ Failed to create AGENTS.md: ${errorMsg}`));
  }
}
