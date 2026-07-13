import { writeFile } from 'node:fs/promises';
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

  try {
    await writeFile(agentsPath, DEFAULT_AGENTS_MD, {
      encoding: 'utf-8',
      flag: force ? 'w' : 'wx',
    });

    const statusMessage = force ? `✓ Overwrote ${agentsPath}` : `✓ Created ${agentsPath}`;
    console.log(chalk.green(statusMessage));
    console.log(chalk.gray('  Edit this file to provide context for the agent'));
  } catch (err: unknown) {
    if (isFileAlreadyExistsError(err)) {
      console.log(chalk.yellow(`! AGENTS.md already exists at ${agentsPath}`));
      console.log(chalk.gray('  Re-run with "sc init --force" to overwrite it'));
      return;
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ Failed to create AGENTS.md: ${errorMsg}`));
  }
}

function isFileAlreadyExistsError(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST');
}
