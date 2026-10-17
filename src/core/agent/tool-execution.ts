import chalk from 'chalk';
import type { ToolCall } from '../types.js';
import { getToolByName } from '../../tools/registry.js';
import type { ToolContext } from '../../tools/tool.js';
import { isMutatingToolCall } from '../../utils/mutation-detector.js';
import { enhanceError, formatEnhancedError } from '../../utils/error-enhancer.js';
import { redactSecrets, redactDeep } from '../../utils/secret-redaction.js';
import { verboseToolCall } from '../../utils/verbose-logger.js';
import type { RunAudit } from './audit.js';

/** Record of one dispatched tool call — feeds self-heal/zero-mutation guards and the run summary. */
export interface ToolUseRecord {
  name: string;
  success: boolean;
  error?: string;
  args?: Record<string, unknown>;
}

/** Tool-result message shape appended to the conversation history. */
export interface ToolResultMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
  name: string;
}

/**
 * Everything the dispatch needs from the agent loop — passed explicitly so
 * the dispatch logic can live outside the Agent class. Callbacks keep the
 * accounting on the agent's own counters/events.
 */
export interface ToolExecutionDeps {
  toolContext: ToolContext;
  /** Shell type for enhanced error hints (this.shellInfo.type). */
  shellType: string;
  /** #424 read-only phase: mutating calls are rejected at dispatch. */
  readOnlyPhase: boolean;
  /** Multi-call responses render compact one-line results. */
  isMultiple: boolean;
  /** Current loop iteration — stamped on audit events. */
  iteration: number;
  audit: RunAudit;
  toolsUsed: ToolUseRecord[];
  log: (...args: any[]) => void;
  emitToolStart: (name: string, args: any) => void;
  emitToolComplete: (name: string, result: string, duration: number) => void;
  emitToolError: (name: string, error: string) => void;
  /** Increment the run's tool counters (total + per-name). */
  onToolRun: (toolName: string) => void;
}

/** Execute a single tool call; failures return an error tool-result instead of throwing (#406). */
export async function executeToolCall(deps: ToolExecutionDeps, toolCall: ToolCall): Promise<ToolResultMessage> {
  const toolName = toolCall.function.name;
  deps.onToolRun(toolName);
  const tool = getToolByName(toolName);

  if (!tool) {
    if (!deps.isMultiple) deps.log(chalk.gray(`  │ ${chalk.red('✗')} Unknown tool: ${toolName}`));
    deps.emitToolError(toolName, 'Unknown tool');
    deps.toolsUsed.push({name: toolName, success: false, error: 'Unknown tool'});
    return {
      role: 'tool' as const,
      content: `Error: Unknown tool ${toolName}`,
      tool_call_id: toolCall.id,
      name: toolName,
    };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    // Malformed tool arguments from the model (truncated stream, bad
    // escaping) — return a tool error result so the model can retry,
    // instead of letting Promise.all reject and crash the run (#406).
    const parseError = `Invalid tool arguments JSON for ${toolName}: ${String(toolCall.function.arguments || '').slice(0, 200)}`;
    deps.emitToolError(toolName, parseError);
    deps.log(chalk.gray(`  │ ${chalk.red('✗')} ${toolName}: ${parseError}`));
    deps.audit.toolArgsParseError(toolName, parseError);
    deps.toolsUsed.push({name: toolName, success: false, error: redactSecrets(parseError)});
    return {
      role: 'tool' as const,
      content: `Error: ${parseError}`,
      tool_call_id: toolCall.id,
      name: toolName,
    };
  }

  // #424 read-only phase gate: the schema already hides the obvious
  // mutating tools, but git/run_shell are dual-purpose — reject
  // invocations classified as mutating at dispatch time.
  if (deps.readOnlyPhase && isMutatingToolCall(toolName, args)) {
    const denied = `Tool call denied: ${toolName} is mutating and this phase is read-only (planner/reviewer phases may inspect but never modify the workspace).`;
    deps.emitToolError(toolName, denied);
    deps.log(chalk.gray(`  │ ${chalk.red('✗')} ${denied}`));
    deps.audit.toolDenied(deps.iteration, toolName, denied);
    deps.toolsUsed.push({name: toolName, success: false, error: redactSecrets(denied), args});
    return {
      role: 'tool' as const,
      content: `Error: ${denied}`,
      tool_call_id: toolCall.id,
      name: toolName,
    };
  }

  const toolStartTime = Date.now();
  try {
    verboseToolCall(toolName, redactDeep(args));

    // Emit tool start event
    deps.emitToolStart(toolName, args);
    deps.audit.toolCall(deps.iteration, toolName, args);

    const result = await tool.execute(args, deps.toolContext);
    const toolDuration = Date.now() - toolStartTime;

    // Emit tool complete event
    deps.emitToolComplete(toolName, result, toolDuration);
    deps.audit.toolResultOk(deps.iteration, toolName, toolDuration, result?.length ?? 0);

    if (deps.isMultiple) {
      deps.log(chalk.gray(`  │    ${chalk.green('✓')} ${toolName}`));
    } else {
      deps.log(chalk.gray(`  │ 🔧 Using tool: ${toolName}`));
      deps.log(chalk.gray(`  │    Args: ${JSON.stringify(redactDeep(args))}`));
      deps.log(chalk.gray(`  │ ${chalk.green('✓')} Tool completed`));
    }

    deps.toolsUsed.push({name: toolName, success: true, args});
    return {
      role: 'tool' as const,
      content: result,
      tool_call_id: toolCall.id,
      name: toolName,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorIcon = deps.isMultiple ? '' : chalk.red('✗');

    // Emit tool error event
    deps.emitToolError(toolName, errorMsg);
    deps.audit.toolResultError(deps.iteration, toolName, Date.now() - toolStartTime, errorMsg);

    deps.log(chalk.gray(`  │ ${errorIcon} ${toolName} failed: ${errorMsg}`));
    deps.toolsUsed.push({name: toolName, success: false, error: redactSecrets(errorMsg), args});

    // Enrich error with contextual analysis so the LLM can respond intelligently
    const enhanced = enhanceError(toolName, errorMsg, deps.shellType);
    const enrichedContent = formatEnhancedError(enhanced);

    return {
      role: 'tool' as const,
      content: enrichedContent,
      tool_call_id: toolCall.id,
      name: toolName,
    };
  }
}

/** Concurrency cap for parallel tool execution — prevents resource exhaustion. */
export const TOOL_CONCURRENCY_LIMIT = 5;

/**
 * Execute tool calls in batches of TOOL_CONCURRENCY_LIMIT. Results preserve
 * the model's call order (batch.map + push order), matching the original
 * inline loop.
 */
export async function executeToolCalls(deps: ToolExecutionDeps, toolCalls: ToolCall[]): Promise<ToolResultMessage[]> {
  const toolResults: ToolResultMessage[] = [];
  for (let i = 0; i < toolCalls.length; i += TOOL_CONCURRENCY_LIMIT) {
    const batch = toolCalls.slice(i, i + TOOL_CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map(tc => executeToolCall(deps, tc)));
    toolResults.push(...batchResults);
  }
  return toolResults;
}
