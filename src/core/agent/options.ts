import type { ProjectConfig, AgentCallbacks } from '../types.js';
import type { CheckpointData } from '../../utils/checkpoint.js';
import type { DevcontainerRunInfo } from '../devcontainer.js';
import type { AgentRole, RoleResolution } from '../roles.js';

export interface AgentOptions {
  workspaceRoot: string;
  config: ProjectConfig;
  autoApprove?: boolean;
  systemPrompt?: string;
  initialPrompt?: string;
  quiet?: boolean;
  callbacks?: AgentCallbacks;
  clearHistory?: boolean;
  permissionMode?: 'ask_once' | 'always_ask' | 'unlimited';
  sessionId?: string;
  resumeCheckpoint?: CheckpointData;
  auditLog?: string;
  livelockThreshold?: number;
  summaryFile?: string;
  outputFile?: string;
  /** #421 devcontainer execution evidence — surfaced in the run manifest. */
  devcontainer?: DevcontainerRunInfo;
  /** 'json' suppresses all human stdout (banner, streamed answer) — the run
   *  manifest JSON line is the only stdout output. */
  outputFormat?: 'text' | 'json';
  maxSteps?: number;
  maxSeconds?: number;
  maxTotalTokens?: number;
  /**
   * #424 multi-model orchestration — pin this run to a single phase role
   * (`--role`/`SC_ROLE`). When unset, a configured `roles` map expands the
   * headless run into the full planner → executor → reviewer pipeline.
   */
  role?: AgentRole;
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
