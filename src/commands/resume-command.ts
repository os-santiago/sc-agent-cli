import path from 'node:path';
import chalk from 'chalk';
import { findLatestCheckpoint, loadCheckpoint, printCheckpointInfo } from '../utils/checkpoint.js';
import type { CheckpointData } from '../utils/checkpoint.js';

export async function resumeSession(workspaceRoot: string): Promise<CheckpointData | null> {
  const cp = findLatestCheckpoint(workspaceRoot);

  if (!cp) {
    console.log(chalk.yellow('\n⚠ No checkpoint found for this workspace.'));
    console.log(chalk.gray('  Start a new session with "sc chat".\n'));
    return null;
  }

  printCheckpointInfo(cp);
  console.log(chalk.gray('\n  Run "sc chat" to start a new session.'));
  console.log(chalk.gray('  Context will be automatically restored from the checkpoint.\n'));

  return cp;
}

export async function findResumeCheckpoint(workspaceRoot: string): Promise<CheckpointData | null> {
  return findLatestCheckpoint(workspaceRoot);
}

export function formatResumeContext(cp: CheckpointData): string {
  const date = new Date(cp.timestamp).toLocaleString();
  return [
    `## Resumed Session`,
    ``,
    `This session was resumed from a checkpoint saved at ${date}.`,
    `Previous session had ${cp.iterations} iterations and used ${cp.toolRunCount} tool calls.`,
    `The conversation history has been restored.`,
    ``,
    `Continue the previous task.`,
  ].join('\n');
}
