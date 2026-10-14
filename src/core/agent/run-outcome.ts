import type { ToolUseRecord } from './tool-execution.js';

/**
 * Post-loop run classification: blocking vs recoverable errors, repeated
 * error loop detection, and the final one-line outcome feedback.
 */

export interface RunOutcome {
  /** true when the loop ended by hitting MAX_ITERATIONS. */
  hitIterationLimit: boolean;
  failedTools: ToolUseRecord[];
  /** Task-crippling errors (permission/syntax/access in core file tools). */
  blockingErrors: ToolUseRecord[];
  /** Error clusters seen ≥3 times — the infinite-loop signature. */
  repeatedErrors: Array<[string, number]>;
  hasRepeatedErrors: boolean;
  successfulTools: ToolUseRecord[];
  hadErrors: boolean;
  /** At least one tool succeeded, no blocking errors, no iteration cap hit. */
  taskCompleted: boolean;
}

export function classifyRunOutcome(toolsUsed: ToolUseRecord[], hitIterationLimit: boolean): RunOutcome {
  const failedTools = toolsUsed.filter(t => !t.success);
  const hadErrors = failedTools.length > 0;

  // Classify blocking errors (task-crippling vs recoverable)
  const blockingErrors = failedTools.filter(t => {
    const errorMsg = (t.error || '').toLowerCase();
    // Blocking errors: permission denied, syntax errors, unauthorized access in core file tools
    const isBlocking =
      (errorMsg.includes('permission denied') && t.name !== 'run_shell') ||
      errorMsg.includes('syntax error') ||
      (errorMsg.includes('cannot read') && t.name !== 'run_shell') ||
      (errorMsg.includes('access denied') && t.name !== 'run_shell');
    return isBlocking;
  });

  // Detect repeated errors (infinite loop detection)
  const errorCounts = new Map<string, number>();
  failedTools.forEach(t => {
    const errorMsg = (t.error || '').toLowerCase();
    const shouldExclude =
      errorMsg.includes('404') ||
      errorMsg.includes('not found') ||
      errorMsg.includes('not recognized') ||
      errorMsg.includes('cannot find the path');

    if (shouldExclude) return;

    let commandKey = t.name;
    if (t.args && typeof t.args === 'object') {
      const args = t.args as Record<string, unknown>;
      if (t.name === 'run_shell' && typeof args.command === 'string') {
        let cmd = args.command.toLowerCase().trim();
        // Strip leading cd commands to avoid clustering all commands under 'cd'
        cmd = cmd.replace(/^cd\s+(?:"[^"]*"|'[^']*'|[^\s&;]+)\s*(?:&&|;|;)\s*/i, '');
        const baseCmd = cmd.split(/[\s|]/)[0];
        commandKey = `${t.name}:${baseCmd}`;
      } else {
        commandKey = t.name;
      }
    }
    errorCounts.set(commandKey, (errorCounts.get(commandKey) || 0) + 1);
  });

  const repeatedErrors = Array.from(errorCounts.entries()).filter(([_, count]) => count >= 3);
  const hasRepeatedErrors = repeatedErrors.length > 0;

  // Determine if task actually completed despite errors
  const successfulTools = toolsUsed.filter(t => t.success);
  const hasBlockingErrors = blockingErrors.length > 0;
  const taskCompleted = successfulTools.length >= 1 && !hasBlockingErrors && !hitIterationLimit;

  return {
    hitIterationLimit,
    failedTools,
    blockingErrors,
    repeatedErrors,
    hasRepeatedErrors,
    successfulTools,
    hadErrors,
    taskCompleted,
  };
}

/**
 * User-visible outcome lines, in the exact order/content the original loop
 * logged them (wrapped in chalk.gray by the caller).
 */
export function summarizeRunOutcome(toolsUsed: ToolUseRecord[], outcome: RunOutcome, maxIterations: number): string[] {
  const lines: string[] = [];

  // Compact fallback warning for iteration limit
  if (outcome.hitIterationLimit) {
    lines.push(`\n  ⚠️  Maximum iteration limit (${maxIterations}) reached`);
    if (outcome.hadErrors) lines.push(`  ${outcome.failedTools.length} error(s) encountered. The task may be incomplete.`);
  }

  // Warning for repeated errors (loop detection)
  if (outcome.hasRepeatedErrors && !outcome.taskCompleted) {
    lines.push('\n  ⚠️  Detected repeated errors (possible infinite loop):');
    outcome.repeatedErrors.forEach(([errorKey, count]) => lines.push(`  ${count}x: ${errorKey.substring(0, 50)}...`));
    lines.push('  The agent attempted the same failing operation multiple times.');
  }

  // One-line feedback per outcome
  if (outcome.hitIterationLimit && !outcome.taskCompleted) {
    lines.push('\n  ❌ Task incomplete - iteration limit reached');
  } else if (outcome.blockingErrors.length > 0) {
    lines.push('\n  ❌ Task incomplete - blocking errors encountered');
  } else if (outcome.hadErrors && outcome.taskCompleted) {
    const errorList = [...new Set(outcome.failedTools.map(t => t.name))].join(', ');
    lines.push(`\n  ✓ Done (recovered from ${outcome.failedTools.length} error(s) in ${errorList})`);
  } else if (outcome.hadErrors && !outcome.taskCompleted) {
    lines.push('\n  ⚠️  Task may be incomplete - errors encountered');
  } else if (toolsUsed.length > 0) {
    const toolNames = [...new Set(toolsUsed.map(t => t.name))].join(', ');
    const plural = toolsUsed.length !== 1 ? 's' : '';
    lines.push(`\n  ✓ Done (${toolsUsed.length} tool operation${plural}: ${toolNames})`);
  }

  return lines;
}
