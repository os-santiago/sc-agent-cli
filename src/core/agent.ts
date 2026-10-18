import chalk from 'chalk';
import { resolve } from 'node:path';
import type { Message, StreamDelta, AgentCallbacks, ToolCall } from './types.js';
import { OpenAICompatibleProvider } from './provider.js';
import { resolveFailoverChain } from './failover.js';
import type { CandidateAttempt } from './failover.js';
import { PhaseTracker, READ_ONLY_PHASE_DENIED_TOOLS } from './roles.js';
import type { AgentRole, PhaseRecord, RoleResolution } from './roles.js';
import { ALL_TOOLS } from '../tools/registry.js';
import type { ToolContext } from '../tools/tool.js';
import { autoCorrectMessageSequence, sanitizeToolCallArguments } from './message-validator.js';
import { detectShell } from '../utils/shell-env.js';
import type { ShellInfo } from '../utils/shell-env.js';
import { renderInline } from '../utils/markdown-renderer.js';
import { boxHeader, boxFooter } from '../utils/box-drawing.js';
import { TokenTracker, estimateMessageTokens, estimateTokens } from '../utils/token-tracker.js';
import type { ContextBudgetReport } from '../utils/context-budget.js';
import { AuditLogger } from '../utils/audit-log.js';
import { verbose, verboseSession } from '../utils/verbose-logger.js';
import { SandboxRuntime } from '../utils/sandbox.js';
import type { SandboxViolation, SandboxRunInfo } from '../utils/sandbox.js';
import { resolveThrottleConfig } from '../utils/throttle.js';
import {
  getWorkspaceGitState,
  hasWorktreeChangesExcluding,
} from '../utils/mutation-detector.js';
import { redactSecrets, redactDeep, registerConfigSecrets } from '../utils/secret-redaction.js';
import { DEFAULT_SYSTEM_PROMPT } from './agent/system-prompt.js';
import type { AgentOptions, AgentRunPhaseOptions } from './agent/options.js';
import {
  compressOldMessages,
  pruneMessageHistory,
  limitMessageHistory,
  compressToolResult,
  redactToolCall,
  TOOL_RESULT_SYNTHESIS_NUDGE,
} from './agent/message-history.js';
import {
  buildSystemInjection,
  rebudgetSystemMessage,
  emitContextBudgetWarning,
  accumulateToolOutputSpend,
} from './agent/context-injection.js';
import { RunAudit } from './agent/audit.js';
import { AgentEvents } from './agent/events.js';
import {
  executeToolCalls,
  type ToolExecutionDeps,
  type ToolUseRecord,
} from './agent/tool-execution.js';
import {
  EMPTY_RESPONSE_REPROMPT,
  isEmptyModelResponse,
  shouldAbortOnEmpty,
  buildEmptyResponseError,
  buildLivelockError,
  analyzeProseResponse,
  shouldSelfHeal,
  buildSelfHealReprompt,
  MAX_SELF_HEAL,
  resolveZeroMutationRepromptBudget,
  countWorkspaceMutations,
  isZeroMutationTurn,
  shouldRepromptZeroMutation,
  buildZeroMutationReprompt,
} from './agent/guards.js';
import { maybeAutoSaveCheckpoint } from './agent/checkpointing.js';
import { classifyRunOutcome, summarizeRunOutcome } from './agent/run-outcome.js';

// Back-compat surface: these used to live in this file and are imported
// elsewhere (tests, embedders) — re-export so `import from './agent.js'`
// keeps working (#493).
export { compressOldMessages, pruneMessageHistory, limitMessageHistory } from './agent/message-history.js';
export type { AgentOptions, AgentRunPhaseOptions } from './agent/options.js';

// #537: the history copy must also be wire-valid — a malformed arguments
// string left in `messages` makes the provider reject every later request
// with a deterministic 400. Sanitizing replaces it with the placeholder
// marker (execution below still uses the raw response and reports the
// args-parse failure as a tool error, so the model can retry).
function historyToolCall(call: ToolCall): ToolCall {
  return sanitizeToolCallArguments(redactToolCall(call));
}

export class Agent {
  private provider: OpenAICompatibleProvider;
  private toolContext: ToolContext;
  private systemPrompt: string;
  private isFirstChunk: boolean = true;
  private _thinkingShown: boolean = false;
  private shellInfo: ShellInfo;
  private callbacks?: AgentCallbacks;
  private events: AgentEvents;
  public tokenTracker: TokenTracker;
  private _iterations: number = 0;
  private _totalIterations: number = 0;
  private phaseTracker = new PhaseTracker();
  private _roleFallbacks: AgentRole[] = [];
  private _phaseModel: string | null = null;
  private _toolRunCount: number = 0;
  private _toolCallCounts = new Map<string, number>();
  private _lastCheckpointIteration: number = 0;
  private _sessionId: string = '';
  private audit?: AuditLogger;
  private auditRun: RunAudit;
  private _budgetExceeded: 'steps' | 'seconds' | 'tokens' | null = null;
  // #449: turns that closed with zero workspace changes after the guard's
  // re-prompt budget was exhausted — accumulated across phase runs so the
  // batch exit path can escalate the terminal outcome.
  private _zeroMutationStalls: number = 0;
  private sandbox?: SandboxRuntime;
  private _contextBudgetReport: ContextBudgetReport | null = null;

  constructor(private options: AgentOptions) {
    this.callbacks = options.callbacks;
    this.events = new AgentEvents(this.callbacks, options.quiet);
    // #472: register the run's credentials for exact-match masking before
    // any tool output or persistence write can carry them.
    registerConfigSecrets(options.config);
    this.provider = new OpenAICompatibleProvider(options.config.model);
    this.provider.setFailoverChain(resolveFailoverChain(options.config));
    const throttle = resolveThrottleConfig(
      options.config.settings?.throttling,
      options.config.model.model,
      options.config.model.baseUrl
    );
    this.provider.setThrottleConfig(throttle);
    if (options.auditLog) {
      try {
        this.audit = new AuditLogger(options.auditLog);
      } catch {
        this.audit = undefined; // unwritable path must not block the run
      }
    }
    this.auditRun = new RunAudit(this.audit);
    // #423 — sandboxed run_shell execution. The runtime resolves the profile,
    // probes the backend (bwrap/proxy-only), and streams violations into the
    // audit log + run manifest. Fail-closed: sandbox setup errors abort the
    // session rather than silently running commands outside the boundary.
    if (options.config.sandbox?.enabled) {
      this.sandbox = new SandboxRuntime({
        config: options.config,
        workspaceRoot: options.workspaceRoot,
        onViolation: (v: SandboxViolation) => {
          this.auditRun.sandboxViolation(v.rule, v.target);
        },
        onNotice: (msg) => this.log(chalk.yellow(`  ⚠ ${msg}`)),
      });
    }
    this.toolContext = {
      workspaceRoot: options.workspaceRoot,
      config: options.config,
      autoApprove: options.autoApprove,
      sandbox: this.sandbox,
    };
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.shellInfo = detectShell();
    this.tokenTracker = new TokenTracker(options.config.model.model);
    this._sessionId = options.sessionId || '';
  }

  getStats(): { iterations: number; totalIterations: number; toolRunCount: number; sessionId: string; budgetExceeded: string | null; zeroMutationStalls: number } {
    return { iterations: this._iterations, totalIterations: this._totalIterations, toolRunCount: this._toolRunCount, sessionId: this._sessionId, budgetExceeded: this._budgetExceeded, zeroMutationStalls: this._zeroMutationStalls };
  }

  /**
   * Enter an orchestration phase (#424): the provider's failover chain is
   * re-rooted at the role's resolved candidate (SC_FAILOVER still cascades
   * behind it), token accounting is scoped to the role, and a phase segment
   * opens in the manifest log. Fallbacks record `role_fallback`.
   */
  beginPhase(res: RoleResolution): void {
    if (res.fallback && !this._roleFallbacks.includes(res.role)) {
      this._roleFallbacks.push(res.role);
    }
    this._phaseModel = res.candidate.model.model;
    this.phaseTracker.begin(res.role, res.candidate);
    this.tokenTracker.setRole(res.role, res.candidate.model.model);
    this.provider.setFailoverChain(resolveFailoverChain(this.options.config, res.candidate));
    this.provider.setThrottleConfig(resolveThrottleConfig(
      this.options.config.settings?.throttling,
      res.candidate.model.model,
      res.candidate.model.baseUrl
    ));
  }

  /** Close the active phase — restores the run's default failover chain. */
  endPhase(): void {
    this.phaseTracker.end();
    this.tokenTracker.setRole(null);
    this._phaseModel = null;
    this.provider.setFailoverChain(resolveFailoverChain(this.options.config));
    this.provider.setThrottleConfig(resolveThrottleConfig(
      this.options.config.settings?.throttling,
      this.options.config.model.model,
      this.options.config.model.baseUrl
    ));
  }

  /** Append-only phase segments for the run manifest (#424). */
  getPhases(): PhaseRecord[] {
    return this.phaseTracker.getPhases();
  }

  /** Roles that fell back to the run's default model (manifest `role_fallback`). */
  getRoleFallbacks(): AgentRole[] {
    return [...this._roleFallbacks];
  }

  /** "provider/model" label of the failover candidate that served the last call. */
  get providerUsed(): string | null {
    return this.provider.providerUsed;
  }

  /** Per-tool invocation counts for the current session (#415 usage summary). */
  getToolCallCounts(): Record<string, number> {
    return Object.fromEntries(this._toolCallCounts);
  }

  /** "provider/model" label of the failover candidate serving this run (#425). */
  getProviderUsed(): string | null {
    return this.provider.providerUsed;
  }

  /**
   * Per-source context-spend accounting for the system-prompt injection
   * of the current run (#422). Null until the first run() assembles or
   * accounts the system message.
   */
  getContextBudget(): ContextBudgetReport | null {
    return this._contextBudgetReport;
  }

  /** Failed-attempt records from the last provider call (failover manifest). */
  getFailoverAttempts(): CandidateAttempt[] {
    return this.provider.failoverAttempts;
  }

  /** Manifest-facing sandbox posture, or null when sandboxing is disabled (#423). */
  getSandboxInfo(): SandboxRunInfo | null {
    return this.sandbox?.enabled ? this.sandbox.getRunInfo() : null;
  }

  /** Structured sandbox violations observed this run (#423). */
  getSandboxViolations(): SandboxViolation[] {
    return this.sandbox ? [...this.sandbox.violations] : [];
  }

  // Event surface — the payload/redaction details live in AgentEvents
  // (#493); these one-line delegates keep the loop readable.

  /**
   * Conditional log - only outputs if not in quiet mode
   * Emits via callbacks if provided, otherwise falls back to console.log
   */
  private log(...args: Parameters<typeof console.log>): void {
    this.events.log(...args);
  }

  /** Emit progress event */
  private emitProgress(status: string, step?: number, total?: number): void {
    this.events.progress(status, step, total);
  }

  /** Emit tool start event */
  private emitToolStart(name: string, args: any): void {
    this.events.toolStart(name, args);
  }

  /** Emit tool complete event */
  private emitToolComplete(name: string, result: string, duration: number): void {
    this.events.toolComplete(name, result, duration);
  }

  /** Emit tool error event */
  private emitToolError(name: string, error: string): void {
    this.events.toolError(name, error);
  }

  async run(userMessage: string, history: Message[] = [], signal?: AbortSignal, phase?: AgentRunPhaseOptions): Promise<Message[]> {
    // #424: a phase-scoped run re-roots the provider at the role's candidate
    // and opens a manifest segment; the finally guarantees the run's default
    // chain is restored even when the phase throws.
    const roleRes = phase?.routing ?? null;
    if (roleRes) this.beginPhase(roleRes);
    try {
      return await this.runLoop(userMessage, history, signal, phase);
    } finally {
      if (roleRes) this.endPhase();
    }
  }

  private async runLoop(userMessage: string, history: Message[] = [], signal?: AbortSignal, phase?: AgentRunPhaseOptions): Promise<Message[]> {
    // #472: sanitize anything crossing into the provider context — history
    // loaded from disk may carry secrets persisted before this layer existed.
    let messages: Message[] = redactDeep(history);
    const readOnlyPhase = phase?.readOnly ?? false;
    const suppressGuards = phase?.suppressCompletionGuards ?? false;

    verbose(`Prompt received: ${userMessage.length} chars, ~${estimateMessageTokens({ role: 'user', content: userMessage })} tokens (estimated)`);
    verbose(`Auto-approve: ${!!this.options.autoApprove}, Quiet: ${!!this.options.quiet}`);
    verbose(`Model: ${this.options.config.model.model}, Provider: ${this.options.config.model.baseUrl}`);

    // Inject system prompt if not already present
    const hasSystemMessage = messages.some((m) => m.role === 'system');
    if (!hasSystemMessage) {
      const injection = await buildSystemInjection({
        systemPrompt: this.systemPrompt,
        userMessage,
        workspaceRoot: this.options.workspaceRoot,
        config: this.options.config,
        autoApprove: this.options.autoApprove,
        sandbox: this.sandbox,
      });
      this._contextBudgetReport = injection.report;
      emitContextBudgetWarning(injection.report, (line) => this.log(chalk.yellow(line)), this.auditRun);
      messages.unshift({ role: 'system', content: injection.text });
    } else {
      // Restored/resumed history already carries a system message — the
      // injection guard still accounts for it (and re-trims it if the
      // budget shrank since the original assembly).
      const sysIndex = messages.findIndex((m) => m.role === 'system');
      const rebudgeted = rebudgetSystemMessage(messages[sysIndex].content);
      this._contextBudgetReport = rebudgeted.report;
      if (rebudgeted.text !== messages[sysIndex].content) {
        messages[sysIndex] = { ...messages[sysIndex], content: rebudgeted.text };
        emitContextBudgetWarning(rebudgeted.report, (line) => this.log(chalk.yellow(line)), this.auditRun);
      }
    }

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    let continueLoop = true;
    const MAX_ITERATIONS = parseInt(process.env.SC_MAX_ITERATIONS || '100', 10);
    const runStartTime = Date.now();
    let budgetExceeded: 'steps' | 'seconds' | 'tokens' | null = null;
    let iterations = 0;
    let selfHealCount = 0;
    let emptyResponseCount = 0;
    let totalEmptyResponses = 0;
    let consecutiveNoToolResponses = 0;
    const livelockLimit = this.options.livelockThreshold ?? (this.options.autoApprove ? 3 : 0);
    let markupRepromptCount = 0;
    const MAX_MARKUP_REPROMPTS = 2;
    let zeroMutationReprompts = 0;
    // Re-prompt budget for the zero-mutation completion guard (#448).
    // Env override follows the SC_MAX_ITERATIONS convention; invalid
    // values fall back to the default, 0 disables the guard.
    const zeroMutationRepromptBudget = resolveZeroMutationRepromptBudget();
    const unattendedRun = Boolean(this.options.autoApprove) || this.options.permissionMode === 'unlimited';
    // Snapshot the worktree before the first LLM call so the guard can
    // detect mutations made through unclassified paths (e.g. a shell
    // heredoc write the command classifier missed).
    const runGitStateBefore = unattendedRun ? getWorkspaceGitState(this.options.workspaceRoot) : null;
    const toolsUsed: ToolUseRecord[] = [];

    // Reset first chunk flag for new run
    this.isFirstChunk = true;
    this.provider.setConsecutiveEmpty(0);
    this.provider.setLastCallWasError(false);

    // Warn if the combined prompt (system + context + user) is very large
    const estimatedPromptTokens = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    const configuredMax = this.options.config.model.maxTokens;
    const threshold = configuredMax != null ? configuredMax * 4 : 32000;
    if (estimatedPromptTokens > threshold) {
      this.log(chalk.yellow(
        `\n  ⚠️  Estimated prompt size: ~${estimatedPromptTokens} tokens. ` +
        `This may exceed the model's effective context window. ` +
        `Consider simplifying the prompt or increasing model context.\n`
      ));
    }

    while (continueLoop && iterations < MAX_ITERATIONS) {
      if (signal?.aborted) {
        this.log(chalk.gray('\n  ⚠️  Task aborted by user'));
        break;
      }

      // Execution budgets (#408): graceful stop before the next LLM call —
      // a budget hit ends the run cleanly instead of an external SIGKILL.
      if (this.options.maxSeconds && Date.now() - runStartTime >= this.options.maxSeconds * 1000) {
        budgetExceeded = 'seconds';
      } else if (this.options.maxSteps && this._toolRunCount >= this.options.maxSteps) {
        budgetExceeded = 'steps';
      } else if (this.options.maxTotalTokens && this.tokenTracker.getUsage().totalTokens >= this.options.maxTotalTokens) {
        budgetExceeded = 'tokens';
      }
      if (budgetExceeded) {
        this._budgetExceeded = budgetExceeded;
        if (!this.options.quiet) {
          this.log(chalk.yellow(`\n  ⚠️  Budget exhausted (${budgetExceeded}) — ending run gracefully.`));
        }
        break;
      }

      iterations++;
      this._iterations = iterations;
      this._totalIterations++;

      // CRITICAL: Validate, compress, prune, and auto-correct message sequence before sending to LLM.
      // Compression+pruning keeps the context window and request size within limits for long runs.
      try {
        messages = compressOldMessages(messages, 30, 300);
        messages = pruneMessageHistory(messages, 10, 600);
        messages = limitMessageHistory(messages, 80);
        messages = autoCorrectMessageSequence(messages);
      } catch (error) {
        console.error(chalk.red('Message sequence validation failed:'), error);
        throw error;
      }

      // Monitor memory usage every 10 iterations
      if (iterations % 10 === 0) {
        const memUsage = process.memoryUsage();
        const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        if (heapMB > heapTotalMB * 0.8) {
          this.log(chalk.yellow(`\n  ⚠️  High memory usage: ${heapMB}MB/${heapTotalMB}MB. Consider using /checkpoint save and restart.`));
        }
      }

      // Estimate input tokens before sending
      let reqEstTokens = 0;
      for (const msg of messages) {
        const est = estimateMessageTokens(msg);
        reqEstTokens += est;
        this.tokenTracker.addInput(est);
      }
      this.auditRun.llmRequest(iterations, this._phaseModel ?? this.options.config.model.model, messages.length, reqEstTokens);
      const llmStartTime = Date.now();

      // Show thinking indicator on first iteration
      if (iterations === 1 && !this.options.quiet) {
        process.stdout.write(chalk.gray('\n  🤔 '));
        this._thinkingShown = true;
      }

      let response: Awaited<ReturnType<typeof this.provider.chatCompletion>>;
      try {
        response = await this.provider.chatCompletion(
          {
            messages,
            // #424 read-only phases (planner/reviewer) never see mutating
            // tools in the schema — defense in depth alongside the dispatch
            // gate in executeToolCall.
            tools: ALL_TOOLS
              .filter((t) => !readOnlyPhase || !READ_ONLY_PHASE_DENIED_TOOLS.has(t.definition.function.name))
              .map((t) => t.definition),
            // Respect the configured transport mode. Some OpenAI-compatible
            // providers return empty streamed tool deltas while non-streaming
            // responses contain valid tool calls.
            stream: this.options.config.model.stream ?? true,
            signal,
          },
          this.onStreamChunk.bind(this)
        );
        this.provider.setLastCallWasError(false);
      } catch (err) {
        this.provider.setLastCallWasError(true);
        this.auditRun.llmResponseError(iterations, this._phaseModel ?? this.options.config.model.model, Date.now() - llmStartTime, err);
        throw err;
      }

      // Track output tokens
      let resEstTokens = 0;
      if (response.content) {
        const est = estimateMessageTokens({ role: 'assistant', content: response.content });
        resEstTokens += est;
        this.tokenTracker.addOutput(est);
      }
      if (response.tool_calls) {
        for (const tc of response.tool_calls) {
          const est = estimateMessageTokens({ role: 'assistant', content: tc.function.name + tc.function.arguments });
          resEstTokens += est;
          this.tokenTracker.addOutput(est);
        }
      }
      // #424: provider-reported usage supersedes the chars/4 estimates above —
      // fold the difference into the tracker so totals and per-role buckets
      // reflect real counts whenever the API reports them.
      if (response.usage) {
        const promptTok = response.usage.prompt_tokens;
        const completionTok = response.usage.completion_tokens;
        if (typeof promptTok === 'number' && promptTok !== reqEstTokens) {
          this.tokenTracker.addInput(promptTok - reqEstTokens);
        }
        if (typeof completionTok === 'number' && completionTok !== resEstTokens) {
          this.tokenTracker.addOutput(completionTok - resEstTokens);
          resEstTokens = completionTok;
        }
        const cached = response.usage.prompt_tokens_details?.cached_tokens;
        if (typeof cached === 'number' && cached > 0) {
          this.tokenTracker.addCached(cached);
        }
      }
      this.phaseTracker.noteServed(this.provider.providerUsed);
      this.auditRun.llmResponseOk(
        iterations, this._phaseModel ?? this.options.config.model.model,
        Date.now() - llmStartTime,
        response.content?.length ?? 0, response.tool_calls?.length ?? 0,
        resEstTokens,
      );

      // Save checkpoint every 5 iterations for long-running sessions
      this._lastCheckpointIteration = await maybeAutoSaveCheckpoint({
        sessionId: this._sessionId,
        lastCheckpointIteration: this._lastCheckpointIteration,
        iterations,
        workspaceRoot: this.options.workspaceRoot,
        messages,
        toolRunCount: this._toolRunCount,
      });

      // Add assistant response to history (#472: masked copy — the model can
      // echo secrets it saw in tool output into content or write_file args).
      // `response` itself stays raw: tool_calls execute verbatim below.
      const assistantMessage: Message = {
        role: 'assistant',
        content: typeof response.content === 'string' ? redactSecrets(response.content) : response.content,
        tool_calls: response.tool_calls?.map(historyToolCall),
      };
      messages.push(assistantMessage);

      // Handle EMPTY RESPONSES (no content, no tool calls)
      if (isEmptyModelResponse(response)) {
        // Clear thinking indicator if shown
        if (this._thinkingShown) {
          process.stdout.write('\x1b[2K\r');
          this._thinkingShown = false;
          this.isFirstChunk = true;
        }
        messages.pop(); // Remove empty assistant message to prevent role sequence violations
        emptyResponseCount++;
        totalEmptyResponses++;
        this.provider.setConsecutiveEmpty(emptyResponseCount);

        // Abort catches both the consecutive-empties stall and the
        // oscillation pattern where tool calls reset the consecutive
        // counter while total empties keep climbing.
        if (shouldAbortOnEmpty(totalEmptyResponses, emptyResponseCount)) {
          if (!this.options.quiet) {
            this.log(chalk.red(`\n  ⚠️  Model returned ${totalEmptyResponses} empty responses in ${iterations} iterations. Aborting.\n`));
          }
          throw buildEmptyResponseError(totalEmptyResponses, iterations);
        }

        // Push a NEW user message for re-prompting — never modify existing messages
        messages.push({
          role: 'user',
          content: EMPTY_RESPONSE_REPROMPT,
        });
        if (!this.options.quiet) {
          this.log(chalk.yellow('\n  │ 🔄 Re-prompting for response...'));
        }
        continue;
      } else {
        emptyResponseCount = 0; // Reset consecutive empty responses counter
        this.provider.setConsecutiveEmpty(0);
        this.provider.setLastCallWasError(false);
      }

      // Recover tool calls embedded as markup inside `content` (#417 harmony;
      // #533 tag-structured models): providers routing non-OpenAI protocols —
      // devin/swe-2-class gateways stream a `summary` envelope while actions
      // ride a native channel, Hermes/llama.cpp and Anthropic-style adapters
      // leak `tool_call`/`invoke`/`function` tags — can deliver invocations as
      // in-content markup instead of a structured tool_calls field. Left
      // alone the agent treats that text as the final answer and the turn
      // ends with zero workspace mutations (scc:zero-mutations:*).
      const noStructuredCalls = !response.tool_calls || response.tool_calls.length === 0;
      if (noStructuredCalls && typeof response.content === 'string') {
        const { hasEmbeddedActionMarkup, recoverEmbeddedToolCalls } = await import('../utils/embedded-tool-calls.js');
        if (hasEmbeddedActionMarkup(response.content)) {
          const recovered = recoverEmbeddedToolCalls(response.content);
          if (recovered.length > 0) {
            response.tool_calls = recovered;
            assistantMessage.tool_calls = recovered.map(historyToolCall);
            if (!this.options.quiet) {
              this.log(chalk.yellow(`\n  │ ♻️  Recovered ${recovered.length} tool call(s) from markup in content`));
            }
          } else {
            markupRepromptCount++;
            if (markupRepromptCount <= MAX_MARKUP_REPROMPTS) {
              messages.push({
                role: 'user',
                content: `[MALFORMED TOOL CALL ${markupRepromptCount}/${MAX_MARKUP_REPROMPTS}] Your previous message embedded a tool call as text markup inside content (a "tool_call", "invoke" or channel-markup tag) instead of a structured tool call. Re-emit the intended action using the proper tool_calls field. Do NOT output tool calls as text markup.`,
              });
              if (!this.options.quiet) {
                this.log(chalk.yellow(`\n  │ 🔄 Tool-call markup detected in content — re-prompting (${markupRepromptCount}/${MAX_MARKUP_REPROMPTS})...`));
              }
              continue;
            }
            throw new Error(
              `Model emitted tool calls as markup inside content ${markupRepromptCount} times instead of structured tool_calls. ` +
              'This indicates a provider/model format incompatibility — try a different model, ' +
              'lower temperature (0.2-0.3), or disabling streaming (stream: false).'
            );
          }
        }
      }

      // Handle tool calls if any - PARALLEL EXECUTION
      if (response.tool_calls && response.tool_calls.length > 0) {
        consecutiveNoToolResponses = 0;
        this.log(chalk.gray(`\n${boxHeader('Tools', 2)}`));

        const isMultiple = response.tool_calls.length > 1;
        if (isMultiple) {
          this.log(chalk.gray(`  │ 🚀 Executing ${response.tool_calls.length} tools in parallel...`));
        }

        // Emit progress event
        this.emitProgress(
          `Executing ${response.tool_calls.length} tool${response.tool_calls.length > 1 ? 's' : ''}`,
          undefined,
          response.tool_calls.length
        );

        // Execute tool calls with a concurrency cap — dispatch details live
        // in agent/tool-execution.ts (#493); callbacks keep the counters.
        const execDeps: ToolExecutionDeps = {
          toolContext: this.toolContext,
          shellType: this.shellInfo.type,
          readOnlyPhase,
          isMultiple,
          iteration: iterations,
          audit: this.auditRun,
          toolsUsed,
          log: (...args: any[]) => this.log(...args),
          emitToolStart: (name, args) => this.emitToolStart(name, args),
          emitToolComplete: (name, result, duration) => this.emitToolComplete(name, result, duration),
          emitToolError: (name, error) => this.emitToolError(name, error),
          onToolRun: (toolName) => {
            this._toolRunCount++;
            this._toolCallCounts.set(toolName, (this._toolCallCounts.get(toolName) || 0) + 1);
          },
        };
        const toolResults = await executeToolCalls(execDeps, response.tool_calls);

        // CRITICAL: Check if the model only responded with tool calls and no text
        // Some models (NVIDIA Nemotron, older Llama) don't auto-generate synthesis
        // Force a continuation prompt to get a visible response for the user
        const hasToolCallsWithoutContent =
          response.tool_calls &&
          response.tool_calls.length > 0 &&
          (!response.content || response.content.trim() === '');

        // Push all results to messages — and account tool-output context
        // spend (#422): raw vs post-compression estimated tokens.
        // #472: every tool result crosses the shared redaction layer before
        // entering history — this is the boundary that keeps secrets out of
        // the provider context, sessions, checkpoints, and manifests.
        let toolOutRequested = 0;
        let toolOutInjected = 0;
        for (let i = 0; i < toolResults.length; i++) {
          const result = toolResults[i];
          toolOutRequested += estimateTokens(result.content);
          result.content = compressToolResult(redactSecrets(result.content));
          if (i === toolResults.length - 1 && hasToolCallsWithoutContent) {
            // Append the nudge/instruction directly to the last tool result content.
            // This maintains the strict API role sequence (user -> assistant -> tool -> assistant)
            // for picky API gateways (e.g. Anthropic, NVIDIA NIM) while still prompting the model for synthesis.
            result.content += TOOL_RESULT_SYNTHESIS_NUDGE;
          }
          toolOutInjected += estimateTokens(result.content);
          messages.push(result);
        }
        accumulateToolOutputSpend(this._contextBudgetReport, toolOutRequested, toolOutInjected);

        // Summary for multiple tools
        if (isMultiple) {
          const successful = toolsUsed.filter(t => t.success).length;
          const failed = toolsUsed.filter(t => !t.success).length;
          this.log(chalk.gray(`  │`));
          if (failed > 0) {
            this.log(chalk.gray(`  │ ${chalk.yellow('📊')} Tools: ${successful} succeeded, ${failed} failed`));
          } else {
            this.log(chalk.gray(`  │ ${chalk.green('✓')} All ${successful} tools completed successfully`));
          }
        }
        this.log(chalk.gray(boxFooter(2)));
      } else {
        // No tool calls — check if LLM is reporting errors without fixing them
        const content = response.content || '';
        const hasToolRun = toolsUsed.length > 0;

        // Tool livelock detection: N consecutive non-empty responses without
        // tool calls means the model narrates instead of acting. A single
        // text response is fine (legit final answer ends the loop at 1) —
        // only a streak reaching the threshold is a livelock.
        consecutiveNoToolResponses++;
        // #424: planner/reviewer phases legitimately emit consecutive prose
        // responses — the livelock guard does not apply to them.
        if (!suppressGuards && livelockLimit > 0 && consecutiveNoToolResponses >= livelockLimit) {
          throw buildLivelockError(consecutiveNoToolResponses, iterations, content);
        }

        const signals = analyzeProseResponse(content, { autoApprove: this.options.autoApprove, hasToolRun });
        const doSelfHeal = shouldSelfHeal(signals, { suppressGuards, hasToolRun, selfHealCount });

        // Metrics: log self-heal decision
        if (process.env.SC_DEBUG_METRICS) {
          verbose(`[METRICS] Self-heal: ${doSelfHeal ? 'ACTIVATED' : 'SKIPPED'} | Conversational: ${signals.isConversational} | Short: ${signals.isShortResponse} | Count: ${selfHealCount}/${MAX_SELF_HEAL}`);
        }

        if (doSelfHeal) {
          selfHealCount++;
          // Strategy-aware prompt: tracks what's been tried (see guards.ts)
          messages.push({
            role: 'user',
            content: buildSelfHealReprompt({
              selfHealCount,
              iteration: iterations,
              toolsUsed,
              autoApprove: this.options.autoApprove,
              isFutureIntention: signals.isFutureIntention,
              isDeferring: signals.isDeferring,
            }),
          });
          if (!this.options.quiet) {
            this.log(chalk.yellow(`\n  │ 🔧 Auto-continuing (${selfHealCount}/${MAX_SELF_HEAL}) — forcing fix...`));
          }
          continue;
        }

        // Zero-mutation completion guard (#448, hardened #449): an
        // unattended run whose prompt requests workspace changes must not
        // end its turn having produced zero real workspace changes —
        // weak/auto-routed models narrate a plan or paste the fix as prose,
        // and mutating calls that left no worktree trace (no-op write,
        // reverted edit, untracked path) count the same as no calls at all
        // (failure signature scc:zero-mutations:*). When git tracks the
        // workspace the status/HEAD delta is the authority; without git,
        // classified mutating tool calls are the only signal. Re-prompt a
        // bounded number of times; a turn that still closes with zero
        // changes after the budget is spent is recorded as a zero-mutation
        // stall so the batch exit path can escalate it (SCC_ZERO_MUTATIONS)
        // instead of reporting a clean no-changes terminal. Explicit
        // no-change/terminal verdicts are honored.
        const mutatingCalls = countWorkspaceMutations(toolsUsed);
        const gitStateAfter = unattendedRun ? getWorkspaceGitState(this.options.workspaceRoot) : null;
        const gitTracked = runGitStateBefore !== null && gitStateAfter !== null;
        // Engine-owned artifacts appended during the run (an --audit-log
        // JSONL placed inside the worktree) are not workspace mutations —
        // without the exclusion the guard would see its own log as "work".
        const engineArtifacts = this.options.auditLog
          ? [resolve(this.options.workspaceRoot, this.options.auditLog)]
          : undefined;
        const zeroMutationCheck = {
          suppressGuards,
          unattendedRun,
          repromptsUsed: zeroMutationReprompts,
          repromptBudget: zeroMutationRepromptBudget,
          mutatingCalls,
          userMessage,
          content,
          worktreeChanged: hasWorktreeChangesExcluding(runGitStateBefore, gitStateAfter, engineArtifacts),
          gitTracked,
        };
        const zeroMutationTurn = isZeroMutationTurn(zeroMutationCheck);
        if (shouldRepromptZeroMutation(zeroMutationCheck)) {
          zeroMutationReprompts++;
          messages.push({
            role: 'user',
            content: buildZeroMutationReprompt(zeroMutationReprompts, zeroMutationRepromptBudget, iterations, mutatingCalls),
          });
          if (!this.options.quiet) {
            this.log(chalk.yellow(`\n  │ 🔧 Zero-mutation turn blocked (${zeroMutationReprompts}/${zeroMutationRepromptBudget}) — forcing execution...`));
          }
          continue;
        }
        if (zeroMutationTurn && zeroMutationRepromptBudget > 0) {
          // Consecutive zero-change turns defeated the re-prompt budget —
          // a stall, not a legitimate no-op. The batch exit path reads the
          // counter and escalates the terminal to SCC_ZERO_MUTATIONS so the
          // failure is attributed to this run instead of surfacing later as
          // "zero file changes" in the caller's verify phase (#449).
          this._zeroMutationStalls++;
          this.audit?.emit({
            type: 'zero_mutation_stall',
            iteration: iterations,
            reprompts: zeroMutationReprompts,
            mutating_tool_calls: mutatingCalls,
            model: this._phaseModel ?? this.options.config.model.model,
          });
          verbose(`[ZERO-MUTATION] turn closed with zero workspace changes after ${zeroMutationReprompts} re-prompt(s)`);
          if (!this.options.quiet) {
            this.log(chalk.yellow(`\n  │ ⚠️  Zero-mutation stall — ${zeroMutationReprompts} re-prompt(s) produced no workspace changes`));
          }
        }

        // No tool calls, finish the loop
        continueLoop = false;
      }
    }

    const hitIterationLimit = iterations >= MAX_ITERATIONS;
    const outcome = classifyRunOutcome(toolsUsed, hitIterationLimit);
    for (const line of summarizeRunOutcome(toolsUsed, outcome, MAX_ITERATIONS)) {
      this.log(chalk.gray(line));
    }

    verboseSession(this._sessionId || 'none', messages.length);

    // Emit completion event
    this.callbacks?.onComplete?.({
      type: 'complete',
      timestamp: Date.now(),
      data: {
        messages,
        toolsUsed: toolsUsed.map(t => t.name),
        iterations,
      },
    });

    return messages;
  }

  private onStreamChunk(delta: StreamDelta): void {
    if (delta.content) {
      // JSON headless mode: the manifest carries final_message — keep stdout clean
      if (this.options.outputFormat === 'json') return;
      // Clear thinking indicator on first content
      if (this._thinkingShown) {
        // ANSI: erase entire line, carriage return
        process.stdout.write('\x1b[2K\r');
        this._thinkingShown = false;
      }
      if (this.isFirstChunk) {
        process.stdout.write('\n');
        this.isFirstChunk = false;
      }
      process.stdout.write(renderInline(delta.content));
    }
  }
}
