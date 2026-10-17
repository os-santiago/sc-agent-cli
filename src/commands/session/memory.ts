import chalk from 'chalk';
import { persistentMemory } from '../../utils/memory.js';
import type { SlashCommandHandler } from './types.js';

/** `/memory` — view/manage the workspace-scoped persistent memory (#476). */
export const handleMemory: SlashCommandHandler = async (ctx, input) => {
  if (!input.toLowerCase().startsWith('/memory')) return false;
  try {
    const args = input.trim().split(/\s+/);
    const subcommand = args[1]?.toLowerCase();
    const workspaceRoot = ctx.options.workspaceRoot;

    if (subcommand === 'clear') {
      await persistentMemory.clear(workspaceRoot);
      console.log(chalk.green('\n✓ All persistent memories cleared (workspace, global, and legacy)\n'));
    } else if (subcommand === 'forget' && args[2]) {
      const key = args.slice(2).join(' ');
      const removed = await persistentMemory.forget(key, workspaceRoot);
      if (removed) {
        console.log(chalk.green(`\n✓ Forgotten memory: "${key}"\n`));
      } else {
        console.log(chalk.yellow(`\n⚠ No memory found with key: "${key}"\n`));
      }
    } else if (subcommand === 'move') {
      // /memory move <key> --to workspace|global — re-file between scopes (#476)
      const toIdx = args.findIndex(a => a === '--to');
      const target = toIdx >= 0 ? args[toIdx + 1]?.toLowerCase() : undefined;
      const key = (toIdx >= 0 ? args.slice(2, toIdx) : args.slice(2)).join(' ');
      if (!key || (target !== 'workspace' && target !== 'global')) {
        console.log(chalk.yellow('\n⚠ Usage: /memory move <key> --to workspace|global\n'));
      } else {
        const moved = await persistentMemory.move(key, target, workspaceRoot);
        console.log(chalk.green(`\n✓ Moved memory "${moved.key}" → ${moved.scope} scope\n`));
      }
    } else if (subcommand === 'show' && (args[2]?.toLowerCase() === '--all' || args[2]?.toLowerCase() === '-a')) {
      // Include quarantined legacy entries (pre-scoping memories) (#476)
      const summary = await persistentMemory.getSummary(workspaceRoot, { all: true });
      console.log(chalk.cyan(`\n${summary}\n`));
    } else if (subcommand === 'show' && args[2]) {
      const key = args.slice(2).join(' ');
      const entry = await persistentMemory.recallEntry(key, workspaceRoot);
      if (entry) {
        console.log(chalk.cyan(`\n📝 Memory: ${entry.key} [${entry.scope}]\n`));
        console.log(chalk.gray(entry.content));
        console.log();
      } else {
        console.log(chalk.yellow(`\n⚠ No memory found with key: "${key}"\n`));
      }
    } else {
      // Show summary (workspace + global tiers; legacy stays hidden)
      const summary = await persistentMemory.getSummary(workspaceRoot);
      console.log(chalk.cyan(`\n${summary}\n`));

      if (summary !== 'No stored memories.') {
        console.log(chalk.gray('Commands:'));
        console.log(chalk.gray('  /memory show <key>                      - View a specific memory'));
        console.log(chalk.gray('  /memory show --all                      - Include legacy (pre-scoping) memories'));
        console.log(chalk.gray('  /memory move <key> --to workspace|global - Re-file a memory between scopes'));
        console.log(chalk.gray('  /memory forget <key>                    - Remove a memory'));
        console.log(chalk.gray('  /memory clear                           - Remove all memories'));
        console.log(chalk.gray('  /remember [--global] <text>             - Save a quick memory'));
        console.log();
      }
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
  }
  return true;
};

/**
 * `/remember [--global] <text>` — quick save to persistent memory (#476).
 * Default scope is the workspace tier; `--global` opts in to the
 * cross-workspace tier.
 */
export const handleRemember: SlashCommandHandler = async (ctx, input) => {
  if (!input.toLowerCase().startsWith('/remember')) return false;
  try {
    const tokens = input.trim().slice('/remember'.length).trim().split(/\s+/).filter(Boolean);
    const globalIdx = tokens.findIndex(t => t === '--global' || t === '-g');
    const scope = globalIdx >= 0 ? 'global' : 'workspace';
    if (globalIdx >= 0) tokens.splice(globalIdx, 1);
    const text = tokens.join(' ');
    if (!text) {
      console.log(chalk.yellow('\n⚠ Usage: /remember [--global] <text>\n'));
    } else {
      const base = `note-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      let key = base;
      for (let n = 2; await persistentMemory.recallEntry(key, ctx.options.workspaceRoot); n++) {
        key = `${base}-${n}`;
      }
      await persistentMemory.remember(key, text, [], { scope, workspaceRoot: ctx.options.workspaceRoot });
      console.log(chalk.green(`\n✓ Saved to ${scope} memory: "${key}"\n`));
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
  }
  return true;
};
