import { access, readFile, writeFile } from 'node:fs/promises';
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function initProject(cwd: string, force = false): Promise<void> {
  const agentsPath = path.join(cwd, 'AGENTS.md');

  try {
    if (await fileExists(agentsPath)) {
      if (!force) {
        console.log(chalk.yellow(`! AGENTS.md already exists at ${agentsPath}`));
        console.log(chalk.gray('  Re-run with --force to overwrite the existing file'));
        return;
      }

      const existingContent = await readFile(agentsPath, 'utf-8');
      if (existingContent === DEFAULT_AGENTS_MD) {
        console.log(chalk.gray(`ℹ AGENTS.md already matches the default template at ${agentsPath}`));
        return;
      }
    }

    await writeFile(agentsPath, DEFAULT_AGENTS_MD, 'utf-8');
    console.log(chalk.green(`${force ? '✓ Overwrote' : '✓ Created'} ${agentsPath}`));
    console.log(chalk.gray('  Edit this file to provide context for the agent'));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ Failed to create AGENTS.md: ${errorMsg}`));
  }
}
