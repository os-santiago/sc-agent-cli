import type { Message } from '../types.js';

/** Auto-save cadence: a checkpoint lands every 5 completed iterations. */
export const CHECKPOINT_INTERVAL = 5;

export interface AutoCheckpointOptions {
  sessionId: string;
  /** Iteration of the last successful checkpoint attempt. */
  lastCheckpointIteration: number;
  iterations: number;
  workspaceRoot: string;
  messages: Message[];
  toolRunCount: number;
}

/**
 * Periodic checkpoint for long-running sessions (#399 crash recovery).
 * Best-effort: checkpoint failures never abort the run. Returns the
 * iteration the next checkpoint should be measured from — the original
 * code stamped `_lastCheckpointIteration` before attempting the write,
 * so a failed save still advances the marker.
 */
export async function maybeAutoSaveCheckpoint(opts: AutoCheckpointOptions): Promise<number> {
  if (!opts.sessionId || opts.iterations - opts.lastCheckpointIteration < CHECKPOINT_INTERVAL) {
    return opts.lastCheckpointIteration;
  }
  try {
    const { saveCheckpoint } = await import('../../utils/checkpoint.js');
    saveCheckpoint({
      sessionId: opts.sessionId,
      workspaceRoot: opts.workspaceRoot,
      history: opts.messages,
      inputHistory: [],
      iterations: opts.iterations,
      toolRunCount: opts.toolRunCount,
    });
  } catch { /* checkpoint is best-effort */ }
  return opts.iterations;
}
