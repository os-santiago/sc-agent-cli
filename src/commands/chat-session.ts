import prompts from 'prompts';
import chalk from 'chalk';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../../package.json') as { version: string };
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Agent } from '../core/agent.js';
import type { AgentOptions } from '../core/agent.js';
import type { Message } from '../core/types.js';
import { checkStorageLimit, enforceStorageLimit, formatBytes } from '../utils/storage-limit.js';
import { statusBar, getShortcutsBar } from '../utils/status-bar.js';
import { persistentMemory } from '../utils/memory.js';
import { boxHeader, boxFooter } from '../utils/box-drawing.js';
import { resolveSettings } from '../utils/settings.js';
import { verbose, verboseSession, verboseError } from '../utils/verbose-logger.js';
import { getWorkspaceGitState, detectSessionMutations, countMutatingToolCalls } from '../utils/mutation-detector.js';
import { writeFileSecureSync } from '../utils/secure-fs.js';
import { buildRunManifest, emitRunManifest, type RunExitReason } from '../utils/run-manifest.js';
import { detectSessionResolution } from '../utils/resolution-detector.js';
import { EXIT_CODES } from '../utils/exit-codes.js';
import { registerConfigSecrets } from '../utils/secret-redaction.js';
import { writeSessionTrace, writeSessionStatus } from '../utils/session-trace.js';
import { resolveRolePipeline, resolveMaxRoleFixes, runRolePipeline } from '../core/roles.js';
import type { ReviewerDecision } from '../core/roles.js';
// Slash-command handlers and the multi-line input editor were extracted
// from this file in #493 — see src/commands/session/*.
import {
  dispatchSlashCommand,
  readUserInput,
  persistSessionHistory,
  type SessionContext,
} from './session/index.js';

  export async function startChatSession(options: AgentOptions): Promise<void> {
  let agent = new Agent(options);
  let history: Message[] = [];
  const historyCheckpoints: Message[][] = [];
  let currentConfig = options.config;
  // #472: session persistence helpers below run before/without the agent —
  // register the run's credentials up front for exact-match masking.
  registerConfigSecrets(currentConfig);
  let inputHistory: string[] = [];
  let currentPermissionMode: 'ask_once' | 'always_ask' | 'unlimited' = options.permissionMode || (options.autoApprove ? 'unlimited' : 'ask_once');
    const settings = resolveSettings(currentConfig);
  let hudEnabled = settings.hud;
  let hudFields = settings.hudFields;

  // Truncate helper for banner
  function trunc(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // Workspace-specific history files (so each directory has its own context)
  function getHistoryPaths(ws: string): { conv: string; input: string } {
    const safe = ws.replace(/[:/\\]/g, '_');
    const base = join(homedir(), '.sc-agent', 'memory', 'workspaces');
    return { conv: join(base, `conv-${safe}.json`), input: join(base, `input-${safe}.json`) };
  }
  const historyPaths = getHistoryPaths(options.workspaceRoot);

  // Generate session ID: safe workspace path + timestamp (using only alphanumeric and "-")
  const safeWsPath = options.workspaceRoot.toLowerCase()
    .replace(/[:/\\]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const timestamp = new Date().toISOString()
    .replace(/\..+/, '')
    .replace(/[^0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const sessionId = options.sessionId || `${safeWsPath}-${timestamp}`;
  options = { ...options, sessionId };

  verbose(`Session initialized: ${sessionId}`);
  verbose(`Profile: ${currentConfig.activeProfile || 'default'} (${currentConfig.model.model})`);
  verbose(`Mode: ${options.initialPrompt ? 'batch' : 'interactive'}, Permissions: ${currentPermissionMode}`);

  // Helper to persist session trace to the unique instance directory.
  // Write path lives in utils/session-trace.ts — every message crosses the
  // shared redaction layer (#472) before hitting disk.
  function saveSessionTrace(msgs: Message[]) {
    writeSessionTrace(sessionId, msgs);  }

  // Mutation detection is delegated to mutation-detector.ts: per-tool-call
  // classification (incl. run_shell command analysis) plus a post-run git
  // worktree diff that catches writes made through unclassified paths.

  // Helper to write machine-readable status for automation
  function saveSessionStatus(status: string, error?: string, historyMsgs?: Message[]) {
    const hasChanges = historyMsgs ? countMutatingToolCalls(historyMsgs) > 0 : false;
    const statusData: Record<string, unknown> = {
      status,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      changes: hasChanges,
      model: currentConfig.model.model,
      provider: currentConfig.model.provider,
    };
    if (error) statusData.error = error;
    writeSessionStatus(sessionId, statusData);  }

  // Load persisted conversation + input history for this workspace
  try {
    if (options.clearHistory) {
      if (existsSync(historyPaths.conv)) {
        writeFileSecureSync(historyPaths.conv, JSON.stringify([], null, 2));
      }
      history = [];
    } else if (existsSync(historyPaths.conv)) {
      const data = readFileSync(historyPaths.conv, 'utf-8');
      history = JSON.parse(data);
    }
    if (existsSync(historyPaths.input)) {
      const data = readFileSync(historyPaths.input, 'utf-8');
      inputHistory = JSON.parse(data);
    }
    // Save initial session trace (skip if empty — prevents session.json = [])
    if (history.length > 0) {
      saveSessionTrace(history);
    }
  } catch {
    // Start fresh
  }

  // --resume: replace history with the checkpoint's and annotate (#402).
  // The note uses role 'user': a system message after restored history
  // trips the message validator (system must lead the conversation).
  if (options.resumeCheckpoint) {
    const cp = options.resumeCheckpoint;
    history = JSON.parse(JSON.stringify(cp.history));
    const { formatResumeContext } = await import('./resume-command.js');
    history.push({ role: 'user', content: `[system note]\n${formatResumeContext(cp)}` });
    if (!options.quiet) {
      console.log(chalk.green(`\n✓ Resumed session ${cp.sessionId} from ${new Date(cp.timestamp).toLocaleString()} (${cp.history.length} messages, ${cp.iterations} iterations)\n`));
    }
  }

  // Load saved permissions (needed for banner display)
  let savedPerms: { mode: string; restoreOnStart: boolean } | undefined;
  if (options.autoApprove === undefined) {
    try {
      const { loadPermissions } = await import('../utils/permissions-store.js');
      savedPerms = loadPermissions();
      if (savedPerms.restoreOnStart) {
        currentPermissionMode = savedPerms.mode as 'ask_once' | 'always_ask' | 'unlimited';
      }
    } catch {
      // No saved permissions
    }
  }

  // Check storage limit on startup
  const configDir = join(homedir(), '.sc-agent');
  const storageInfo = checkStorageLimit(configDir);

  // Non-interactive mode: skip UI decorations if quiet flag is set.
  // --output-format json implies quiet: the manifest is the only stdout output.
  const isQuiet = options.quiet || options.outputFormat === 'json';
  const isNonInteractive = Boolean(options.initialPrompt);

  if (!isQuiet) {
    const tw = process.stdout.columns || 80;
    const outer = tw - 2;
    const colW = Math.floor((outer - 6) / 2);

    function row2(label1: string, val1: string, label2: string, val2: string): void {
      const t1 = `${label1} ${val1}`;
      const t2 = `${label2} ${val2}`;
      const fill1 = colW - t1.length + 2;
      console.log(chalk.cyan(`│ ${t1}${' '.repeat(Math.max(0, fill1))}${t2}${' '.repeat(Math.max(0, outer - 4 - t1.length - Math.max(0, fill1) - t2.length))} │`));
    }

    console.log(chalk.cyan(`┌${'─'.repeat(outer)}┐`));
    const title = `  ⚡ scc  —  SC-Agent CLI (v${packageVersion})`;
    console.log(chalk.cyan(`│ ${chalk.bold(title)}${' '.repeat(outer - title.length - 2)} │`));
    console.log(chalk.cyan(`├${'─'.repeat(outer)}┤`));

    // Row 1: Workspace (full width)
    const ws = `${chalk.gray('📁 Workspace')} ${chalk.white(options.workspaceRoot)}`;
    console.log(chalk.cyan(`│ ${ws}${' '.repeat(outer - ws.length - 2)} │`));

    // Row 2: Model + Storage
    row2(
      chalk.gray('🧠 Model'), chalk.white(trunc(currentConfig.model.model, colW - 10)),
      chalk.gray('💾 Storage'), chalk.white(`${formatBytes(storageInfo.currentSize)} / ${formatBytes(storageInfo.maxSize)}`)
    );

    // Row 3: Provider + History
    const providerShort = currentConfig.model.baseUrl.replace(/^https?:\/\//, '').replace(/\/v1$/, '');
    const historyLabel = history.length > 0 ? `${history.length} msgs (restored)` : `${history.length} msgs`;
    row2(
      chalk.gray('🔗 Provider'), chalk.white(trunc(providerShort, colW - 12)),
      chalk.gray('📋 History'), chalk.white(historyLabel)
    );

    // Row 4: Permissions
    const permLabel = chalk.gray('🔐 Permissions');
    let permVal: string;
    if (savedPerms?.restoreOnStart) {
      const modeLabel = savedPerms.mode === 'unlimited' ? 'Unlimited' : savedPerms.mode === 'always_ask' ? 'Always ask' : 'Ask once';
      permVal = chalk.white(`${modeLabel} (auto)`);
    } else if (options.autoApprove) {
      permVal = chalk.white('Unlimited (-y)');
    } else {
      permVal = chalk.white('Ask once');
    }
    const permRow = `${permLabel} ${permVal}`;
    console.log(chalk.cyan(`│ ${permRow}${' '.repeat(outer - permRow.length - 2)} │`));

    console.log(chalk.cyan(`├${'─'.repeat(outer)}┤`));
    const tips = 'exit/quit  /help  /hud  /permissions  /env  /model';
    console.log(chalk.cyan(`│ ${chalk.gray(tips)}${' '.repeat(outer - tips.length - 2)} │`));
    console.log(chalk.cyan(`└${'─'.repeat(outer)}┘\n`));

    if (storageInfo.usagePercent > 80 && !storageInfo.needsCleanup) {
      console.log(chalk.yellow(`⚠️  Storage usage at ${storageInfo.usagePercent.toFixed(1)}% — set SC_MAX_STORAGE_GB`));
    }
  }

  // Permission restore prompt (after banner, only if not auto-restored and mode was changed)
  if (options.autoApprove === undefined && savedPerms && !savedPerms.restoreOnStart && savedPerms.mode !== 'ask_once' && !isQuiet && !isNonInteractive) {
    const { savePermissions } = await import('../utils/permissions-store.js');
    const saved = savedPerms;
    const modeLabel = saved.mode === 'unlimited' ? 'Unlimited' : 'Always ask';
    const response = await prompts({
      type: 'select',
      name: 'choice',
      message: `Previous session had "${modeLabel}" permissions. Restore?`,
      choices: [
        { title: 'Yes', value: 'yes', description: `Use ${modeLabel} mode` },
        { title: 'No (ask once)', value: 'no', description: 'Start with default Ask once mode' },
        { title: "Don't ask again", value: 'always', description: 'Always restore last mode without asking' },
      ],
    });
    if (response.choice === 'yes' || response.choice === 'always') {
      currentPermissionMode = saved.mode as 'ask_once' | 'always_ask' | 'unlimited';
      console.log(chalk.gray(`\n  ✓ Restored: ${modeLabel}\n`));
    }
    if (response.choice === 'always') {
      savePermissions({ restoreOnStart: true });
      console.log(chalk.gray(`  ✓ Won't ask again. Use /permissions to change.\n`));
    }
    if (response.choice === 'no') {
      currentPermissionMode = 'ask_once';
    }
  }

  // Auto-cleanup if over limit
  if (storageInfo.needsCleanup) {
    enforceStorageLimit(configDir, true, isQuiet);
  }

  // Show status bar at bottom (only in interactive mode)
  if (!isNonInteractive && !isQuiet) {
    statusBar.show(getShortcutsBar());
  }

  let batchStart = Date.now();

  // #415/#399: machine-readable run manifest — emitted as the LAST stdout
  // write in batch mode so `sc chat -q ... | tail -1 | jq` stays parseable.
  // With `--output-format json` it is the ONLY stdout write.
  // Resolution detector inputs — hoisted to this scope so the shared
  // emitUsageSummary closure (incl. signal-handler early exits) can read
  // whatever the batch block has populated so far (#446).
  let batchGitStateBefore: ReturnType<typeof getWorkspaceGitState> | null = null;
  let agentError: Error | undefined;
  let budgetExceeded: string | null | undefined;
  // #462 reviewer/judge consensus state — populated by runRolePipeline in
  // the batch block; read by emitUsageSummary for the manifest `review`
  // block (including signal-handler early exits mid-loop).
  const maxRoleFixes = resolveMaxRoleFixes();
  let reviewDecision: ReviewerDecision | null = null;
  let reviewFixRounds = 0;

  // Engine-owned artifacts (--summary-file/--output-file/--audit-log) can be
  // written inside the worktree. They are session artifacts, not real repo
  // diffs — exclude them from the manifest's files_changed (#464).
  const engineArtifactPaths = [options.summaryFile, options.outputFile, options.auditLog]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map(p => resolve(options.workspaceRoot, p));

  const detectResolutionSafely = (exitReason: RunExitReason) => {
    try {
      return detectSessionResolution({
        history,
        exitReason,
        agentError,
        budgetExceeded,
        beforeGitState: batchGitStateBefore,
        afterGitState: getWorkspaceGitState(options.workspaceRoot),
        workspaceRoot: options.workspaceRoot,
        excludePaths: engineArtifactPaths,
        // #449: a guard-defeated zero-change terminal escalates the
        // resolution to `zero_mutations` (SCC_ZERO_MUTATIONS / exit 12).
        zeroMutationStalls: agent.getStats().zeroMutationStalls,
      });
    } catch {
      return undefined;
    }
  };

  const emitUsageSummary = (exitReason: RunExitReason, error?: string, onStdoutFlushed?: () => void) => {
    const usage = agent.tokenTracker.getUsage();
    const stats = agent.getStats();
    const checkpointPath = join(homedir(), '.sc-agent', 'checkpoints', `${sessionId}.json`);
    const manifest = buildRunManifest({
      exitReason,
      error,
      version: packageVersion,
      model: currentConfig.model.model,
      sessionId,
      history,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      // #424: the tracker prices each role at its serving model when the
      // run used role routing; identical to estimateCost(model, ...) for
      // single-phase runs.
      costUsd: agent.tokenTracker.getEstimatedCost(),
      toolCalls: agent.getToolCallCounts(),
      toolRunCount: stats.toolRunCount,
      // totalIterations covers the whole phase pipeline (#424); `iterations`
      // alone would report only the last phase's count.
      iterations: stats.totalIterations,
      durationMs: Date.now() - batchStart,
      checkpointPath: existsSync(checkpointPath) ? checkpointPath : null,
      devcontainer: options.devcontainer,
      provider: agent.providerUsed,
      errorObj: agentError,
      phases: agent.getPhases(),
      roleFallbacks: agent.getRoleFallbacks(),
      roleTokens: agent.tokenTracker.getRoleUsage(),
      cachedTokens: agent.tokenTracker.getCachedTokens(),
      review: reviewDecision
        ? { verdict: reviewDecision.verdict, explicit: reviewDecision.explicit, fixRounds: reviewFixRounds, maxFixes: maxRoleFixes }
        : undefined,
      resolutionInfo: detectResolutionSafely(exitReason),
      sandbox: agent.getSandboxInfo() ?? undefined,
      sandboxViolations: agent.getSandboxViolations(),
      contextBudget: agent.getContextBudget(),
    });
    emitRunManifest(manifest, {
      files: [options.summaryFile, options.outputFile],
      onStdoutFlushed,
    });
  };

  // Batch runs must still emit the manifest when killed by a signal (#399):
  // CI `timeout` sends SIGTERM, Ctrl+C sends SIGINT. stdout is flushed via
  // the write callback before exiting so the JSON line survives on a pipe;
  // the unref'd timer is a fallback if the callback never fires.
  const exitOnSignal = (signal: 'SIGINT' | 'SIGTERM', code: number) => {
    process.exitCode = code;
    try {
      emitUsageSummary('interrupted', `Interrupted by ${signal}`, () => process.exit(code));
    } catch { /* stdout may already be gone — exit non-zero regardless */ }
    setTimeout(() => process.exit(code), 250).unref();
  };

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    if (isNonInteractive) {
      exitOnSignal('SIGINT', 130);
      return;
    }
    if (!isQuiet) {
      statusBar.hide();
      console.log(chalk.gray('\n\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('  👋 Goodbye!'));
      console.log(chalk.gray('╚════════════════════════════════════════════════════════════╝\n'));
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    if (isNonInteractive) {
      exitOnSignal('SIGTERM', 143);
      return;
    }
    process.exit(143);
  });

  // Non-interactive mode: process single prompt and exit
  if (isNonInteractive && options.initialPrompt) {
    const userInput = options.initialPrompt;

    if (!isQuiet) {
      console.log(chalk.blue(`\n${boxHeader('Prompt')}`));
      console.log(chalk.gray(`│ ${userInput}`));
      console.log(chalk.blue(boxFooter()));
    }

    verbose(`Prompt received: ${userInput.length} chars, ~${Math.ceil(userInput.length / 4)} tokens (estimated)`);
    verbose(`Batch mode: autoApprove=${!!options.autoApprove}, quiet=${!!isQuiet}`);

    // Save user message to session BEFORE API call
    const userMsg: Message = { role: 'user', content: userInput, timestamp: new Date().toISOString() };
    const preRunHistory = [...history, userMsg];
    saveSessionTrace(preRunHistory);

    // Process the prompt
    if (!isQuiet) {
      console.log(chalk.gray(`\n${boxHeader('Assistant')}`));
    }

    // duration_ms measures the run itself — reset the clock just before it.
    batchStart = Date.now();
    // Snapshot git state before the agent runs — mutations made via run_shell
    // or unclassified tools are caught by comparing status/HEAD afterwards.
    batchGitStateBefore = getWorkspaceGitState(options.workspaceRoot);
    // #424 multi-model orchestration: when `config.roles` is present (or
    // --role/SC_ROLE pins a single phase) the headless run expands into the
    // planner → executor → reviewer pipeline. Each phase runs on its
    // configured provider/model; absent/invalid mappings fall back to the
    // run's default model and surface as `role_fallback` in the manifest.
    // Without role config the classic single-phase run is preserved.
    // #462: runRolePipeline owns the consensus loop — a reviewer
    // request_changes verdict feeds its comments back to the executor for
    // rework (bounded by SC_ROLE_MAX_FIXES), then re-reviews; a
    // same-provider+model reviewer warns once.
    const rolePipeline = (options.role || currentConfig.roles)
      ? resolveRolePipeline(currentConfig, options.role)
      : null;

    try {
      if (rolePipeline) {
        const result = await runRolePipeline(agent, rolePipeline, userInput, history, {
          maxFixes: maxRoleFixes,
          log: (line) => {
            if (!isQuiet) console.log(chalk.gray(line));
          },
          // Warnings ride stderr: the stdout contract (transcript in text
          // mode, manifest-only under --output-format json) stays intact.
          warn: (line) => console.error(chalk.yellow(`  ${line}`)),
        });
        history = result.history;
        reviewDecision = result.decision;
        reviewFixRounds = result.fixRounds;
      } else {
        history = await agent.run(userInput, history);
      }
    } catch (err: any) {
      agentError = err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Categorize error code based on message content
      let errorCode = 'agent_run_error';
      if (/empty response/i.test(errorMsg)) {
        errorCode = 'empty_response';
      } else if (/fetch|network|timeout|abort|econnrefused|econnreset|api_error|5\d{2}/i.test(errorMsg)) {
        errorCode = 'api_error';
      }
      // Build minimal history with user message + error entry
      history = [
        ...history,
        userMsg,
        {
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          metadata: {
            error: errorMsg,
            error_code: errorCode,
            model: currentConfig.model.model,
            provider: currentConfig.model.provider,
            prompt_tokens_estimated: Math.ceil(userInput.length / 4),
          },
        },
      ];
    }

    if (!isQuiet) {
      console.log(chalk.gray(`${boxFooter()}\n`));
      console.log(chalk.gray(`  🆔 ${sessionId}\n`));
    }

    // Status markers stay greppable, but under --output-format json they go
    // to stderr so stdout carries the manifest only (#399).
    const markerOut = options.outputFormat === 'json' ? console.error : console.log;

    // Save session trace (always, even on error)
    saveSessionTrace(history);
    verboseSession(sessionId, history.length);

    // If agent errored, rethrow so caller sees non-zero exit
    if (agentError) {
      const errorMsg = agentError instanceof Error ? agentError.message : String(agentError);
      saveSessionStatus('error', errorMsg, history);
      verboseError(`Agent run failed: ${errorMsg}`);
      emitUsageSummary('error', errorMsg);
      throw agentError;
    }

    // Check for meaningful response
    const hasMeaningfulResponse = history.some(
      m => m.role === 'assistant' && m.content && m.content.trim().length > 0
    ) || history.some(m => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0);

    if (!hasMeaningfulResponse) {
      // Save again with explicit empty-response entry
      const emptyResponseMsg: Message = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        metadata: { warning: 'Model returned empty response', tokens_received: 0 },
      };
      history = [...history, emptyResponseMsg];
      saveSessionTrace(history);
      saveSessionStatus('no_changes', undefined, history);
      const noMeaningfulMsg = 'No meaningful response generated. The model may not support this prompt length or format.';
      verboseError(noMeaningfulMsg);
      emitUsageSummary('no_changes', noMeaningfulMsg);
      throw new Error(noMeaningfulMsg);
    }

    // Budget exhaustion: run stopped early but gracefully — emit a
    // machine-greppable marker + distinct exit code (22 per #409 sketch),
    // preserving the partial-work summary instead of a SIGKILL.
    budgetExceeded = agent.getStats().budgetExceeded;
    if (budgetExceeded) {
      saveSessionStatus('budget_exceeded', `budget:${budgetExceeded}`, history);
      markerOut(`SC_BUDGET_EXCEEDED ${budgetExceeded}`);
      process.exitCode = EXIT_CODES.BUDGET_EXCEEDED;
      emitUsageSummary('budget_exceeded', `budget exceeded (${budgetExceeded})`);
      return;
    }

    // Zero-mutation signal: run completed but never produced workspace
    // changes (model refused, answered read-only, or only ran inspections —
    // when git tracks the workspace the real worktree diff decides, so
    // mutating calls that left no trace count as no mutations, #449). Emit
    // a machine-greppable marker and exit with the documented code — 11
    // when the terminal resolution is not_actionable/blocked (#446 verdict,
    // wired to the process exit in #486), 12 when the zero-mutation guard's
    // re-prompt budget was exhausted on a mutation-scoped prompt
    // (scc:zero-mutations:* stall — a failed execution, not a no-op), and
    // 10 for the generic no-changes outcome.
    const mutations = detectSessionMutations(history, batchGitStateBefore, getWorkspaceGitState(options.workspaceRoot), engineArtifactPaths);
    if (!mutations.hasMutations) {
      const resolution = detectResolutionSafely('no_changes');
      if (resolution && (resolution.resolution === 'not_actionable' || resolution.resolution === 'blocked')) {
        saveSessionStatus(resolution.resolution, resolution.resolution_reason, history);
        markerOut(resolution.stdout_marker ?? `SCC_${resolution.resolution === 'blocked' ? 'BLOCKED' : 'NOT_ACTIONABLE'}`);
        process.exitCode = EXIT_CODES.NOT_ACTIONABLE;
        emitUsageSummary('no_changes');
        return;
      }
      if (resolution && resolution.resolution === 'zero_mutations') {
        saveSessionStatus('zero_mutations', resolution.resolution_reason, history);
        markerOut(resolution.stdout_marker ?? 'SCC_ZERO_MUTATIONS');
        process.exitCode = EXIT_CODES.ZERO_MUTATIONS;
        emitUsageSummary('zero_mutations');
        return;
      }
      saveSessionStatus('no_changes', undefined, history);
      markerOut('SCC_NO_CHANGES');
      process.exitCode = EXIT_CODES.NO_CHANGES;
      emitUsageSummary('no_changes');
      return;
    }

    // Success — write status and exit
    saveSessionStatus('success', undefined, history);
    emitUsageSummary('success');
    return;
  }

  // Interactive mode loop
  while (true) {
    // Show status bar as prompt indicator, then hide during raw-mode input
    if (!isQuiet) statusBar.show(getShortcutsBar());
    if (!isQuiet) {
      console.log(chalk.blue(`\n${boxHeader('You')}`));
    }
    if (!isQuiet) statusBar.hide();
    const userInput = await readUserInput(inputHistory, options.workspaceRoot);

    if (!userInput) {
      continue;
    }

    if (!isQuiet) {
      // Re-print the user's input with the proper prefix inside the You box, and close it
      const lines = userInput.split('\n');
      for (const line of lines) {
        console.log(chalk.blue('│ ') + line);
      }
      console.log(chalk.blue(boxFooter()));
    }

    // Add to input history (but not commands)
    if (!userInput.startsWith('/') && userInput.toLowerCase() !== 'exit' && userInput.toLowerCase() !== 'quit') {
      inputHistory.push(userInput);
    }

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      statusBar.hide();
      console.log(chalk.gray('\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('  👋 Goodbye!'));
      console.log(chalk.gray('╚════════════════════════════════════════════════════════════╝\n'));
      break;
    }

    // Slash commands live in ./session/* (#493): the loop snapshots its
    // mutable state into a context, dispatch runs the matching handler,
    // and changed fields are copied back before the next prompt.
    const ctx: SessionContext = {
      options,
      sessionId,
      historyPaths,
      saveSessionTrace,
      historyCheckpoints,
      agent,
      history,
      inputHistory,
      currentConfig,
      currentPermissionMode,
      hudEnabled,
      hudFields,
    };
    if (await dispatchSlashCommand(ctx, userInput)) {
      agent = ctx.agent;
      history = ctx.history;
      inputHistory = ctx.inputHistory;
      currentConfig = ctx.currentConfig;
      currentPermissionMode = ctx.currentPermissionMode;
      hudEnabled = ctx.hudEnabled;
      hudFields = ctx.hudFields;
      continue;
    }

    try {
      // Save checkpoint before agent run
      historyCheckpoints.push(JSON.parse(JSON.stringify(history)));
      if (!isQuiet) {
        console.log(chalk.green(`\n${boxHeader('Assistant')}`));
      }
      history = await agent.run(userInput, history);
      // Persist conversation + input history for cross-session/workspace continuity
      ctx.history = history;
      persistSessionHistory(ctx, '\n  ⚠️  Warning: Could not persist conversation history\n');
      if (!isQuiet) {
        console.log(chalk.green(`\n${boxFooter()}`));
      }

      // HUD: compact status line with configurable fields
      if (hudEnabled && !isQuiet) {
        const mem = await persistentMemory.getAll({ workspaceRoot: options.workspaceRoot });
        const storage = checkStorageLimit(join(homedir(), '.sc-agent'));
        const permIcon = currentPermissionMode === 'unlimited' ? '∞' : currentPermissionMode === 'always_ask' ? '🔔' : '✓';
        const profileIcon = currentConfig.permissions?.profile === 'blacklist' ? '🛡️' : '🔒';
        const modelShort = currentConfig.model.model.length > 16
          ? currentConfig.model.model.substring(0, 14) + '..'
          : currentConfig.model.model;
        const msgCount = history.filter(m => m.role === 'assistant').length;
        const stats = agent.getStats();
        const tokenUsage = agent.tokenTracker.formatShort();

        const fieldParts: Record<string, string> = {
          model: chalk.cyan(modelShort),
          profile: chalk.gray(`@${currentConfig.activeProfile || 'default'}`),
          memories: chalk.gray(`🧠${mem.length}`),
          messages: chalk.gray(`💬${msgCount}`),
          storage: chalk.gray(`💾${formatBytes(storage.currentSize)}`),
          permissions: `${profileIcon}${permIcon}`,
          tokens: chalk.magenta(tokenUsage),
          iterations: chalk.cyan(`🔄${stats.iterations}`),
          cost: chalk.yellow(`💰${agent.tokenTracker.getEstimatedCost().toFixed(4)}`),
        };
        const parts = hudFields.filter(f => f in fieldParts).map(f => fieldParts[f]);
        parts.push(chalk.yellow(`🆔 ${sessionId}`));

        if (parts.length > 0) {
          console.log(chalk.gray(`  ${parts.join(chalk.dim(' │ '))}\n`));
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`\n✗ Error: ${errorMsg}\n`));
    }
  }
}
