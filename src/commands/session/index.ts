import type { SessionContext, SlashCommandHandler } from './types.js';
import { handleHelp } from './help.js';
import { handleClear, handleUndo, handleRollback } from './history.js';
import { handleSession } from './session-io.js';
import { handleCheckpoint } from './checkpoint.js';
import { handleHud } from './hud.js';
import { handleEnv, handleProbe, handleConfig, handleInfo } from './info.js';
import { handleMemory, handleRemember } from './memory.js';
import { handlePermissions, handleProfile, handlePreApprovedCommands } from './permissions.js';
import { handleStorage, handleReload, handleModel } from './config.js';

export type { SessionContext, PermissionMode, HistoryPaths, SlashCommandHandler } from './types.js';
export { readUserInput } from './input.js';
export { persistSessionHistory } from './history.js';

/**
 * Slash-command table in the same matching order the REPL used before the
 * #493 extraction — first hit wins, so keep this sequence stable.
 */
const HANDLERS: SlashCommandHandler[] = [
  handleHelp,
  handleClear,
  handleUndo,
  handleRollback,
  handleSession,
  handleCheckpoint,
  handleHud,
  handleEnv,
  handleProbe,
  handleMemory,
  handleRemember,
  handlePermissions,
  handleProfile,
  handlePreApprovedCommands,
  handleStorage,
  handleReload,
  handleConfig,
  handleInfo,
  handleModel,
];

/**
 * Route a REPL line through the slash-command table.
 * Returns `true` when the input was a command (the loop continues) and
 * `false` when it should be treated as a prompt for the agent.
 */
export async function dispatchSlashCommand(ctx: SessionContext, input: string): Promise<boolean> {
  for (const handler of HANDLERS) {
    if (await handler(ctx, input)) return true;
  }
  return false;
}
