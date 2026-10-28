import chalk from 'chalk';
import { dirname } from 'node:path';
import { ensureSecureDirSync, writeFileSecureSync } from '../../utils/secure-fs.js';
import { redactDeep } from '../../utils/secret-redaction.js';
import type { SessionContext, SlashCommandHandler } from './types.js';

/**
 * Persist conversation + input history for cross-session/workspace
 * continuity — the redaction layer (#472) runs before the write and the
 * session trace mirrors the restored state (#493: shared by undo,
 * rollback, import, and the post-run save; the warning text is the only
 * difference between call sites).
 */
export function persistSessionHistory(ctx: SessionContext, warning: string): void {
  try {
    const dir = dirname(ctx.historyPaths.conv);
    ensureSecureDirSync(dir);
    writeFileSecureSync(ctx.historyPaths.conv, JSON.stringify(redactDeep(ctx.history), null, 2));
    writeFileSecureSync(ctx.historyPaths.input, JSON.stringify(redactDeep(ctx.inputHistory), null, 2));
    ctx.saveSessionTrace(ctx.history);
  } catch {
    console.log(chalk.yellow(warning));
  }
}

/** `/clear` — wipe the conversation history. */
export const handleClear: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/clear') return false;
  ctx.history = [];
  ctx.saveSessionTrace(ctx.history);
  console.log(chalk.green('\n✓ Conversation history cleared\n'));
  return true;
};

/** `/undo` — restore the most recent pre-run history checkpoint. */
export const handleUndo: SlashCommandHandler = async (ctx, input) => {
  if (input.toLowerCase() !== '/undo') return false;
  if (ctx.historyCheckpoints.length === 0) {
    console.log(chalk.yellow('\n⚠ Nothing to undo\n'));
    return true;
  }
  const checkpoint = ctx.historyCheckpoints.pop()!;
  ctx.history = checkpoint;
  persistSessionHistory(ctx, '\n  ⚠️  Warning: Could not persist history to disk\n');
  console.log(chalk.green(`\n✓ Undone (${ctx.historyCheckpoints.length} checkpoint(s) remaining)\n`));
  return true;
};

/** `/rollback <n>` — truncate history to message index <n>. */
export const handleRollback: SlashCommandHandler = async (ctx, input) => {
  if (!input.toLowerCase().startsWith('/rollback')) return false;
  const args = input.trim().split(/\s+/);
  if (args.length < 2 || isNaN(Number(args[1]))) {
    console.log(chalk.yellow('\n⚠ Usage: /rollback <message_index>\n'));
    return true;
  }
  const idx = parseInt(args[1]!, 10);
  if (idx < 0 || idx >= ctx.history.length) {
    console.log(chalk.yellow(`\n⚠ Index must be 0-${ctx.history.length - 1}\n`));
    return true;
  }
  ctx.historyCheckpoints.push(JSON.parse(JSON.stringify(ctx.history)));
  ctx.history = ctx.history.slice(0, idx);
  persistSessionHistory(ctx, '\n  ⚠️  Warning: Could not persist history to disk\n');
  console.log(chalk.green(`\n✓ Rolled back to message ${idx} (${ctx.history.length} messages remaining)\n`));
  return true;
};
