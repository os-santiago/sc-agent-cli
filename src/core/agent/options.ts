import type { ProjectConfig, AgentCallbacks } from '../types.js';
import type { CheckpointData } from '../../utils/checkpoint.js';
import type { DevcontainerRunInfo } from '../devcontainer.js';
import type { AgentRole, RoleResolution } from '../roles.js';

export interface AgentOptions {
  workspaceRoot: string;
  config: ProjectConfig;
  autoApprove?: boolean | undefined;
  systemPrompt?: string | undefined;
  initialPrompt?: string | undefined;
  quiet?: boolean | undefined;
  callbacks?: AgentCallbacks | undefined;
  clearHistory?: boolean | undefined;
  permissionMode?: 'ask_once' | 'always_ask' | 'unlimited' | undefined;
  sessionId?: string | undefined;
  resumeCheckpoint?: CheckpointData | undefined;
  auditLog?: string | undefined;
  livelockThreshold?: number | undefined;
  summaryFile?: string | undefined;
  outputFile?: string | undefined;
  /** #421 devcontainer execution evidence — surfaced in the run manifest. */
  devcontainer?: DevcontainerRunInfo | undefined;
  /** 'json' suppresses all human stdout (banner, streamed answer) — the run
   *  manifest JSON line is the only stdout output. */
  outputFormat?: 'text' | 'json' | undefined;
  maxSteps?: number | undefined;
  maxSeconds?: number | undefined;
  maxTotalTokens?: number | undefined;
  /**
   * #424 multi-model orchestration — pin this run to a single phase role
   * (`--role`/`SC_ROLE`). When unset, a configured `roles` map expands the
   * headless run into the full planner → executor → reviewer pipeline.
   */
  role?: AgentRole | undefined;
}

/**
 * Per-phase routing options for `agent.run()` (#424). `routing` pins the
 * provider/model for the duration of the call and scopes token accounting;
 * `readOnly` denies mutating tool calls; `suppressCompletionGuards` skips
 * self-heal/zero-mutation/livelock handling for phases whose correct output
 * is prose (planner plans, reviewer verdicts).
 */
export interface AgentRunPhaseOptions {
  /** Resolved role → candidate routing; presence marks this run as a phase. */
  routing?: RoleResolution;
  readOnly?: boolean;
  suppressCompletionGuards?: boolean;
}
