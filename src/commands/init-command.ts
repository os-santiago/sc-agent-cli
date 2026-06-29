import { writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export async function initProject(cwd: string): Promise<string> {
  const agentsPath = path.join(cwd, 'AGENTS.md');
  await writeFile(agentsPath, DEFAULT_AGENTS_MD, 'utf-8');
  return agentsPath;
}
