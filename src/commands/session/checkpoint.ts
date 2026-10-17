import chalk from 'chalk';
import type { SlashCommandHandler } from './types.js';

/** `/checkpoint save|resume|list` — execution checkpoints for long-running sessions. */
export const handleCheckpoint: SlashCommandHandler = async (ctx, input) => {
  if (!input.toLowerCase().startsWith('/checkpoint')) return false;
  const cpArgs = input.trim().split(/\s+/);
  const cpSub = cpArgs[1]?.toLowerCase();

  if (cpSub === 'save') {
    try {
      const { saveCheckpoint } = await import('../../utils/checkpoint.js');
      saveCheckpoint({
        sessionId: ctx.sessionId,
        workspaceRoot: ctx.options.workspaceRoot,
        history: ctx.history,
        inputHistory: ctx.inputHistory,
        iterations: ctx.agent.getStats().iterations,
        toolRunCount: ctx.agent.getStats().toolRunCount,
      });
      console.log(chalk.green(`\n✓ Checkpoint saved (${ctx.history.length} messages, ${ctx.agent.getStats().iterations} iterations)\n`));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n✗ Checkpoint failed: ${errorMsg}\n`));
    }
  } else if (cpSub === 'resume') {
    try {
      const { findResumeCheckpoint, formatResumeContext } = await import('../resume-command.js');
      const cp = await findResumeCheckpoint(ctx.options.workspaceRoot);
      if (!cp) {
        console.log(chalk.yellow('\n⚠ No checkpoint found for this workspace.\n'));
      } else {
        ctx.history = JSON.parse(JSON.stringify(cp.history));
        const resumeMsg = formatResumeContext(cp);
        ctx.history.push({ role: 'user', content: `[system note]\n${resumeMsg}` });
        console.log(chalk.green(`\n✓ Resumed session from ${new Date(cp.timestamp).toLocaleString()} (${cp.history.length} messages restored)\n`));
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n✗ Resume failed: ${errorMsg}\n`));
    }
  } else if (cpSub === 'list') {
    try {
      const { listCheckpoints, printCheckpointInfo } = await import('../../utils/checkpoint.js');
      const all = listCheckpoints().filter(c => c.workspaceRoot === ctx.options.workspaceRoot);
      if (all.length === 0) {
        console.log(chalk.gray('\n  No checkpoints for this workspace\n'));
      } else {
        console.log(chalk.cyan(`\n📦 Checkpoints (${all.length}):\n`));
        for (const cp of all) {
          printCheckpointInfo(cp);
          console.log();
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
    }
  } else {
    console.log(chalk.cyan('\n📦 Checkpoint Commands\n'));
    console.log(chalk.gray('  /checkpoint save          - Save execution checkpoint'));
    console.log(chalk.gray('  /checkpoint list          - Show saved checkpoints'));
    console.log(chalk.gray('  /checkpoint resume        - Restore last checkpoint for this workspace'));
    console.log(chalk.gray('\n  Checkpoints auto-save every 5 iterations.\n'));
  }
  return true;
};
