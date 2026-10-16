import type { Agent } from '../../core/agent.js';
import type { AgentOptions } from '../../core/agent.js';
import type { Message, ProjectConfig } from '../../core/types.js';

/** Permission modes the interactive session cycles through. */
export type PermissionMode = 'ask_once' | 'always_ask' | 'unlimited';

/** Per-workspace persistence paths for conversation + input history. */
export interface HistoryPaths {
  conv: string;
  input: string;
}

/**
 * Everything a slash-command handler may read or mutate (#493). The REPL
 * loop snapshots its locals into this shape per command and copies the
 * mutable fields back afterwards, so handlers keep honest state flow and
 * the loop stays the single owner of session state.
 */
export interface SessionContext {
  // Immutable for the session's lifetime.
  options: AgentOptions;
  sessionId: string;
  historyPaths: HistoryPaths;
  saveSessionTrace(msgs: Message[]): void;

  // Shared containers — mutated in place (push/pop), never reassigned.
  historyCheckpoints: Message[][];

  // Mutable state — handlers may reassign these; the loop copies them back.
  agent: Agent;
  history: Message[];
  inputHistory: string[];
  currentConfig: ProjectConfig;
  currentPermissionMode: PermissionMode;
  hudEnabled: boolean;
  hudFields: string[];
}

/**
 * A slash-command handler. Returns `true` when the input was consumed —
 * the REPL continues to the next prompt — or `false` when the input is
 * not this handler's command.
 */
export type SlashCommandHandler = (ctx: SessionContext, input: string) => Promise<boolean>;
