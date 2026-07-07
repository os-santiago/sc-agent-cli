import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import type { Message } from '../core/types.js';

const CHECKPOINT_DIR = join(homedir(), '.sc-agent', 'checkpoints');

export interface CheckpointData {
  version: number;
  timestamp: number;
  sessionId: string;
  workspaceRoot: string;
  history: Message[];
  inputHistory: string[];
  iterations: number;
  toolRunCount: number;
}

function ensureDir(): void {
  if (!existsSync(CHECKPOINT_DIR)) {
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }
}

export function saveCheckpoint(data: Omit<CheckpointData, 'version' | 'timestamp'>): string {
  ensureDir();
  const checkpoint: CheckpointData = {
    version: 1,
    timestamp: Date.now(),
    ...data,
  };
  const filePath = join(CHECKPOINT_DIR, `${data.sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
  // Auto-clean old checkpoints on each save
  cleanOldCheckpoints();
  return filePath;
}

export function loadCheckpoint(sessionId: string): CheckpointData | null {
  const filePath = join(CHECKPOINT_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data) as CheckpointData;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function listCheckpoints(): CheckpointData[] {
  ensureDir();
  const files = readdirSync(CHECKPOINT_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const data = readFileSync(join(CHECKPOINT_DIR, f), 'utf-8');
      return JSON.parse(data) as CheckpointData;
    } catch {
      return null;
    }
  }).filter((c): c is CheckpointData => c !== null);
}

export function deleteCheckpoint(sessionId: string): boolean {
  const filePath = join(CHECKPOINT_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function findLatestCheckpoint(workspaceRoot: string): CheckpointData | null {
  const all = listCheckpoints().filter(c => c.workspaceRoot === workspaceRoot);
  if (all.length === 0) return null;
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all[0];
}

const MAX_CHECKPOINT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CHECKPOINT_COUNT = 20;

/**
 * Auto-clean old checkpoints: removes any older than 7 days,
 * and if still over 20, removes the oldest ones.
 */
export function cleanOldCheckpoints(): void {
  ensureDir();
  const now = Date.now();
  const files = readdirSync(CHECKPOINT_DIR).filter(f => f.endsWith('.json'));
  const checkpoints: Array<{ path: string; timestamp: number }> = [];

  for (const file of files) {
    try {
      const data = readFileSync(join(CHECKPOINT_DIR, file), 'utf-8');
      const parsed = JSON.parse(data) as CheckpointData;
      if (now - parsed.timestamp > MAX_CHECKPOINT_AGE_MS) {
        unlinkSync(join(CHECKPOINT_DIR, file));
      } else {
        checkpoints.push({ path: join(CHECKPOINT_DIR, file), timestamp: parsed.timestamp });
      }
    } catch {
      // Corrupt or unparseable — delete it
      try { unlinkSync(join(CHECKPOINT_DIR, file)); } catch { /* ignore */ }
    }
  }

  // If still over the count limit, remove oldest
  if (checkpoints.length > MAX_CHECKPOINT_COUNT) {
    checkpoints.sort((a, b) => b.timestamp - a.timestamp); // newest first
    for (let i = MAX_CHECKPOINT_COUNT; i < checkpoints.length; i++) {
      try { unlinkSync(checkpoints[i].path); } catch { /* ignore */ }
    }
  }
}

export function printCheckpointInfo(cp: CheckpointData): void {
  const date = new Date(cp.timestamp).toLocaleString();
  const msgCount = cp.history.length;
  console.log(chalk.cyan(`\n📦 Checkpoint found:`));
  console.log(chalk.gray(`  Session:  ${cp.sessionId}`));
  console.log(chalk.gray(`  Saved:    ${date}`));
  console.log(chalk.gray(`  Messages: ${msgCount}`));
  console.log(chalk.gray(`  Iterations: ${cp.iterations}`));
  console.log(chalk.gray(`  Tools run: ${cp.toolRunCount}`));
}
