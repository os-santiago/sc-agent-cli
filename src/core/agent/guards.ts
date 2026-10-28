import { isWorkspaceMutatingToolCall, expectsWorkspaceMutation, declaresNoChangesNeeded } from '../../utils/mutation-detector.js';
import type { ToolUseRecord } from './tool-execution.js';

/**
 * Completion guards for the agent loop. Pure decision logic extracted from
 * the run loop so each guard is unit-testable in isolation — the loop only
 * owns the side effects (message pushes, logging, continue/throw).
 */

// ---------------------------------------------------------------------------
// Empty-response guard — catches providers that return no content and no
// tool calls. MAX_TOTAL_EMPTY catches the oscillation pattern where the
// model alternates between tool calls and empty responses (resetting the
// consecutive counter each time).
// ---------------------------------------------------------------------------

export const MAX_TOTAL_EMPTY_RESPONSES = 5;
export const MAX_CONSECUTIVE_EMPTY_RESPONSES = 3;

export const EMPTY_RESPONSE_REPROMPT =
  `[The assistant returned an empty response. Respond to the user's request: output something helpful or call a tool. Do NOT return an empty message.]`;

export function isEmptyModelResponse(response: { content?: string | null | undefined; tool_calls?: readonly unknown[] | null | undefined }): boolean {
  return (!response.content || response.content.trim() === '') &&
    (!response.tool_calls || response.tool_calls.length === 0);
}

export function shouldAbortOnEmpty(totalEmptyResponses: number, consecutiveEmpty: number): boolean {
  return totalEmptyResponses >= MAX_TOTAL_EMPTY_RESPONSES || consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY_RESPONSES;
}

export function buildEmptyResponseError(totalEmptyResponses: number, iterations: number): Error {
  return new Error(
    `Model returned empty response ${totalEmptyResponses} times in ${iterations} iterations. ` +
    `This likely indicates a model compatibility issue with the current provider/model. ` +
    `Try: (1) a different model, (2) lower temperature (0.2-0.3), ` +
    `(3) disabling streaming (stream: false).`
  );
}

// ---------------------------------------------------------------------------
// Tool-livelock guard — N consecutive non-empty responses without tool calls
// means the model narrates instead of acting. A single text response is
// fine (legit final answer ends the loop at 1) — only a streak reaching
// the threshold is a livelock.
// ---------------------------------------------------------------------------

export function buildLivelockError(consecutiveNoToolResponses: number, iterations: number, content: string): Error {
  const lastOutput = content.trim().slice(0, 300);
  return new Error(
    `[SC_LIVELOCK] Model produced ${consecutiveNoToolResponses} consecutive responses ` +
    `without tool calls in ${iterations} iterations — aborting run (tool livelock). ` +
    `Last model output: "${lastOutput}"`
  );
}

// ---------------------------------------------------------------------------
// Self-heal guard — when the model reports errors or narrates intentions
// without calling tools, re-prompt it to act instead of ending the turn.
// Skip purely conversational responses (greetings, clarifications, etc.)
// — but NOT when they also include concrete future actions.
// ---------------------------------------------------------------------------

export const MAX_SELF_HEAL = 10;

export interface ProseSignals {
  isConversational: boolean;
  isShortResponse: boolean;
  isDeferring: boolean;
  isFutureIntention: boolean;
  hasErrorIndicators: boolean;
  hasFailurePhrase: boolean;
}

/** Classify a no-tool-call assistant response for the self-heal decision. */
export function analyzeProseResponse(content: string, opts: { autoApprove?: boolean | undefined; hasToolRun: boolean }): ProseSignals {
  const hasConversationalGreeting = /\b(hello|hi|hey|how are you|doing well|ready to help|what would you like|how can i help|nice to meet|greetings)\b/i.test(content);
  const hasFutureAction = /\b(i will|i'll|i am going to|let's|let me|i need to|i should|i plan to|first, I|first, let)\b/i.test(content);
  return {
    isConversational: hasConversationalGreeting && !hasFutureAction,
    isShortResponse: content.length < 200 && !opts.hasToolRun && !hasFutureAction,
    isDeferring: /\b(would you like|do you want|shall I|¿quieres|recommend|suggest|you (should|could|need to))\b/i.test(content),
    isFutureIntention: Boolean(opts.autoApprove) && /\b(i will|i'll|i am going to|let's|let me|i need to|i should|i plan to|first, I|first, let|we will|we'll|voy a|comenzaré|primero|debo|tengo que|procederé)\b/i.test(content),
    hasErrorIndicators: /[❌✗⚠]/.test(content) || /\b(error|failed|fall[óo]|fail(ure)?)\b/i.test(content),
    hasFailurePhrase: /\b(does not compile|compilation error|syntax error|cannot find|unable to|not compile|build fail)/i.test(content),
  };
}

export function shouldSelfHeal(
  signals: ProseSignals,
  opts: { suppressGuards: boolean; hasToolRun: boolean; selfHealCount: number; maxSelfHeal?: number },
): boolean {
  const max = opts.maxSelfHeal ?? MAX_SELF_HEAL;
  return (
    !opts.suppressGuards &&
    !signals.isConversational &&
    !signals.isShortResponse &&
    (signals.isDeferring || signals.isFutureIntention || signals.hasFailurePhrase || (signals.hasErrorIndicators && opts.hasToolRun))
    && opts.selfHealCount < max
  );
}

/**
 * Strategy-aware self-heal re-prompt: tracks which tools already failed so
 * the model is pushed toward a DIFFERENT approach.
 */
export function buildSelfHealReprompt(opts: {
  selfHealCount: number;
  iteration: number;
  toolsUsed: ToolUseRecord[];
  autoApprove?: boolean | undefined;
  isFutureIntention: boolean;
  isDeferring: boolean;
  maxSelfHeal?: number | undefined;
}): string {
  const max = opts.maxSelfHeal ?? MAX_SELF_HEAL;
  const triedTools = [...new Set(opts.toolsUsed.filter(t => !t.success).map(t => t.name))].join(', ');
  const errorSummary = opts.toolsUsed.filter(t => !t.success).slice(-5)
    .map(t => `  - ${t.name}: ${(t.error || '').substring(0, 100)}`)
    .join('\n');
  let urgency = opts.selfHealCount > 3
    ? `This is attempt ${opts.selfHealCount}. You MUST resolve these issues now. Do not repeat what you already said.`
    : `You identified issues above but must take action to fix them.`;
  if (triedTools) {
    urgency += `\nTools that have failed: ${triedTools}.\nRecent errors:\n${errorSummary}\nTry a DIFFERENT approach — don't repeat the same failing operations.`;
  }
  if (opts.autoApprove) {
    if (opts.isFutureIntention) {
      urgency = `You described a plan or future intention, but you did not execute any tools in this iteration. You are in non-interactive auto-approve mode, so you have full permission. You MUST NOT just describe your plan. Execute the tools immediately to proceed with your plan.`;
    } else if (opts.isDeferring) {
      urgency = `You proposed or suggested an action, but you did not execute any tools in this iteration. You are in non-interactive auto-approve mode, so you have full permission. Execute the tools immediately to apply your proposal.`;
    } else {
      urgency += ` You are in non-interactive auto-approve mode, so you have full permission. Execute the tools to apply your proposal immediately.`;
    }
  }
  return `[SELF-HEAL ${opts.selfHealCount}/${max} — iteration ${opts.iteration}] ${urgency} Use the available tools to fix ALL problems. Do not ask for permission. Do not summarize again. Fix it now.`;
}

// ---------------------------------------------------------------------------
// Zero-mutation completion guard (#448): an unattended run whose prompt
// requests workspace changes must not end its turn having executed zero
// mutating tools — weak/auto-routed models narrate a plan or paste the fix
// as prose and the run exits SCC_NO_CHANGES with nothing applied (failure
// signature scc:zero-mutations:*). Re-prompt a bounded number of times;
// afterwards the turn ends normally and the caller still gets the
// documented no-changes exit contract. An explicit no-changes verdict is
// honored.
// ---------------------------------------------------------------------------

export const DEFAULT_ZERO_MUTATION_REPROMPTS = 2;

/**
 * Re-prompt budget for the zero-mutation completion guard. Env override
 * follows the SC_MAX_ITERATIONS convention; invalid values fall back to
 * the default, 0 disables the guard.
 */
export function resolveZeroMutationRepromptBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = parseInt(env.SC_ZERO_MUTATION_REPROMPTS ?? '', 10);
  return Number.isNaN(raw) ? DEFAULT_ZERO_MUTATION_REPROMPTS : Math.max(0, raw);
}

/** Successful workspace-mutating calls (memory_write doesn't count — it mutates ~/.sc-agent, not the workspace). */
export function countWorkspaceMutations(toolsUsed: ToolUseRecord[]): number {
  return toolsUsed.reduce(
    (n, t) => n + (t.success && isWorkspaceMutatingToolCall(t.name, t.args) ? 1 : 0),
    0
  );
}

export interface ZeroMutationCheck {
  suppressGuards: boolean;
  unattendedRun: boolean;
  repromptsUsed: number;
  repromptBudget: number;
  mutatingCalls: number;
  userMessage: string;
  content: string;
  /** hasWorktreeChanges(before, after) — computed by the caller. */
  worktreeChanged: boolean;
}

export function shouldRepromptZeroMutation(c: ZeroMutationCheck): boolean {
  return (
    !c.suppressGuards &&
    c.unattendedRun &&
    c.repromptsUsed < c.repromptBudget &&
    c.mutatingCalls === 0 &&
    expectsWorkspaceMutation(c.userMessage) &&
    !declaresNoChangesNeeded(c.content) &&
    !c.worktreeChanged
  );
}

export function buildZeroMutationReprompt(used: number, budget: number, iteration: number): string {
  return (
    `[ZERO-MUTATION ${used}/${budget} — iteration ${iteration}] ` +
    `The turn is about to end, but this run produced ZERO workspace changes — no write_file, edit_file, mutating git operation, or mutating run_shell command was executed. ` +
    `The task requires modifying the workspace. Do NOT describe or paste the fix in prose — apply it now using the tools. ` +
    `If the task is genuinely read-only, or the requested change is already present, state explicitly that no changes are required and explain why.`
  );
}

// ---------------------------------------------------------------------------
// Harmony-format recovery (#417): some providers emit Harmony
// markup ("<CHANNEL>commentary to=functions.X<MESSAGE>{args}" — with
// "|" wrappers) as plain text instead of structured tool_calls, which
// would otherwise end the turn silently with zero changes.
// The tag literals below are built via concatenation so the exact
// markup tokens never appear verbatim in source.
// ---------------------------------------------------------------------------

/** Harmony channel tag ("<" + "|channel|>") — the marker checked in content. */
export const HARMONY_CHANNEL_TAG = '<' + '|channel|>';
/** Harmony message tag ("<" + "|message|>"). */
export const HARMONY_MESSAGE_TAG = '<' + '|message|>';

export const MAX_HARMONY_REPROMPTS = 2;

export function buildHarmonyReprompt(count: number): string {
  return `[MALFORMED TOOL CALL ${count}/${MAX_HARMONY_REPROMPTS}] Your previous message embedded a tool call as Harmony markup ("${HARMONY_CHANNEL_TAG}...${HARMONY_MESSAGE_TAG}") inside content instead of a structured tool call. Re-emit the intended action using the proper tool_calls field. Do NOT output ${HARMONY_CHANNEL_TAG} markup.`;
}

export function buildHarmonyError(count: number): Error {
  return new Error(
    `Model emitted Harmony markup tool calls inside content ${count} times instead of structured tool_calls. ` +
    'This indicates a provider/model format incompatibility — try a different model, ' +
    'lower temperature (0.2-0.3), or disabling streaming (stream: false).'
  );
}