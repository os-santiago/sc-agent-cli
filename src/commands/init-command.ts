import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';

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

interface InitProjectOptions {
  force?: boolean;
}

export async function initProject(cwd: string, options: InitProjectOptions = {}): Promise<void> {
  const agentsPath = path.join(cwd, 'AGENTS.md');

  try {
    const exists = await access(agentsPath)
      .then(() => true)
      .catch(() => false);

    if (exists && !options.force) {
      console.log(chalk.yellow(`! AGENTS.md already exists at ${agentsPath}`));
      console.log(chalk.gray('  Re-run `sc init --force` to overwrite it'));
      return;
    }

    await writeFile(agentsPath, DEFAULT_AGENTS_MD, 'utf-8');
    const action = exists ? 'Overwrote' : 'Created';
    console.log(chalk.green(`✓ ${action} ${agentsPath}`));
    console.log(chalk.gray('  Edit this file to provide context for the agent'));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ Failed to create AGENTS.md: ${errorMsg}`));
  }
}
