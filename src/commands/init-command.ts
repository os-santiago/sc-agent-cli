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

export async function initProject(cwd: string, force = false): Promise<void> {
  const agentsPath = path.join(cwd, 'AGENTS.md');

  const agentsExists = await fileExists(agentsPath);

  if (agentsExists && !force) {
    console.log(chalk.red(`✗ AGENTS.md already exists at ${agentsPath}`));
    console.log(chalk.gray('  Re-run `sc init --force` to overwrite it'));
    return;
  }

  await writeFile(agentsPath, DEFAULT_AGENTS_MD, 'utf-8');
  console.log(chalk.green(`✓ ${agentsExists ? 'Overwrote' : 'Created'} ${agentsPath}`));
  console.log(chalk.gray('  Edit this file to provide context for the agent'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
