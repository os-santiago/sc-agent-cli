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

export async function initProject(cwd: string): Promise<void> {
  const agentsPath = path.join(cwd, 'AGENTS.md');

  try {
    await access(agentsPath);
    throw new Error(
      `AGENTS.md already exists at ${agentsPath}. Move or remove it before running "sc init" again.`
    );
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('ENOENT')) {
      throw err;
    }
  }

  await writeFile(agentsPath, DEFAULT_AGENTS_MD, 'utf-8');
  console.log(chalk.green(`✓ Created ${agentsPath}`));
  console.log(chalk.gray('  Edit this file to provide context for the agent'));
}
