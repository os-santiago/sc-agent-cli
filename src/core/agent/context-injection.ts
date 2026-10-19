import type { ProjectConfig } from '../types.js';
import { loadProjectContext, loadPolicyFile } from '../project-context.js';
import { generateRepoMap } from '../repo-map.js';
import { probeRepo, formatRepoProfileForPrompt } from '../repo-probe/index.js';
import { persistentMemory } from '../../utils/memory.js';
import { detectShell, getShellPromptSections } from '../../utils/shell-env.js';
import {
  applyContextBudget,
  formatContextBudgetTrims,
  resolveContextBudget,
  type ContextBudgetReport,
  type ContextSource,
} from '../../utils/context-budget.js';
import type { SandboxRuntime } from '../../utils/sandbox.js';
import { redactSecrets } from '../../utils/secret-redaction.js';
import { verbose } from '../../utils/verbose-logger.js';

const PROJECT_QUERY_PATTERN = /\b(file|code|test|build|install|run|debug|fix|error|implement|refactor|check|verify|review|analyze|src\/|\.ts|\.js|\.json|\.yaml|\.yml|\.md|\.sh|\.py|\.java|\.go|\.rb|\.c|\.cpp|\.h|package|config|git|npm|pnpm|yarn|mvn|gradle|cargo|pip|docker|create|write|edit|read|search|grep|find|directory|folder|function|class|method|variable|import|export|module|component|service|controller|repository|endpoint|api|route|database|query|schema|migration|deploy|lint|format|commit|push|pull|merge|branch|tag|release|version|dependency|dependencies|bug|issue|feature|docs|documentation|README|LICENSE|Makefile|Dockerfile|workflow|action|pipeline|ci|cd|devops|kubernetes|helm|terraform|ansible)\b/i;

/** Only load project context for project-related queries (not for casual conversation). */
export function isProjectRelatedQuery(userQuery: string): boolean {
  return PROJECT_QUERY_PATTERN.test(userQuery);
}

export interface SystemInjectionOptions {
  /** Base system prompt (`options.systemPrompt` or DEFAULT_SYSTEM_PROMPT). */
  systemPrompt: string;
  /** The user's message — drives the project-query heuristic. */
  userMessage: string;
  workspaceRoot: string;
  config: ProjectConfig;
  autoApprove?: boolean | undefined;
  sandbox?: SandboxRuntime | undefined;
}

export interface SystemInjectionResult {
  /** Assembled system prompt after budget enforcement. */
  text: string;
  /** Per-source spend accounting for the manifest (#422). */
  report: ContextBudgetReport;
}

/**
 * Assemble the system-prompt injection for a fresh run: base prompt +
 * shell guide + repo profile + repo map (skeleton mode) + project context +
 * persistent memory + non-interactive note + sandbox notice, then enforce
 * the SC_CONTEXT_BUDGET_TOKENS cap (#422).
 *
 * Context injection mode (#461): 'skeleton' swaps the whole-file
 * project-context injection for a generated repo map (`repo_map`
 * source) — the agent pulls file bodies via read_file on demand.
 * An explicitly configured policyFile is operator doctrine and is
 * still injected (as project_context) even in skeleton mode.
 */
export async function buildSystemInjection(opts: SystemInjectionOptions): Promise<SystemInjectionResult> {
  const policyFile = opts.config.settings?.policyFile || process.env.SC_POLICY_FILE;

  const userQuery = opts.userMessage;
  const isProjectQuery = isProjectRelatedQuery(userQuery);

  const contextMode = opts.config.context?.mode ?? 'full';
  let projectContext: string | null = null;
  let repoMapContext: string | null = null;
  if (isProjectQuery) {
    if (contextMode === 'skeleton') {
      try {
        const generatedMap = await generateRepoMap(opts.workspaceRoot, opts.config);
        repoMapContext = generatedMap ? redactSecrets(generatedMap) : generatedMap;
      } catch {
        // Non-fatal: fall back to no index rather than failing the run.
      }
      const policyContext = policyFile
        ? await loadPolicyFile(opts.workspaceRoot, policyFile)
        : null;
      projectContext = policyContext ? redactSecrets(policyContext) : policyContext;
    } else {
      const loadedContext = await loadProjectContext(opts.workspaceRoot, policyFile);
      projectContext = loadedContext ? redactSecrets(loadedContext) : loadedContext;
    }
  }

  // Metrics: log context loading decision (optional - only if SC_DEBUG_METRICS is set)
  if (process.env.SC_DEBUG_METRICS) {
    verbose(`[METRICS] Context loading: ${isProjectQuery ? 'LOADED' : 'SKIPPED'} | mode: ${contextMode} | Query length: ${userQuery.length} | Context size: ${projectContext?.length || 0}B | Repo map: ${repoMapContext?.length || 0}B`);
  }

  let repoProfileContext: string | null = null;
  if (isProjectQuery) {
    try {
      const profile = await probeRepo(opts.workspaceRoot);
      repoProfileContext = redactSecrets(`\n# Repository Profile & Toolchain\n${formatRepoProfileForPrompt(profile)}`);
    } catch {
      // Non-fatal if probe fails
    }
  }

  // #472: injected sources feed the provider context too — persisted
  // memory entries and repo docs can carry committed secrets.
  const memoryContext = redactSecrets(await persistentMemory.getContextString(opts.workspaceRoot));

  // Detect shell environment for cross-platform adaptation
  const shellInfo = detectShell();
  const shellContext = `\n# Shell Environment\n- Type: ${shellInfo.type}\n- Platform: ${process.platform}\n- Tips:\n${shellInfo.tips.map(t => `  • ${t}`).join('\n')}`;
  const shellPromptGuide = getShellPromptSections(shellInfo);

  // Named injection sources so context spend is accounted per source
  // (#422). Assembly order is preserved for the final join; the
  // budget guard trims in CONTEXT_SOURCE_PRIORITY order instead.
  const contextSources: ContextSource[] = [
    { source: 'system', text: opts.systemPrompt },
    { source: 'shell', text: `${shellContext}\n${shellPromptGuide}` },
  ];
  if (repoProfileContext) contextSources.push({ source: 'repo_profile', text: repoProfileContext });
  if (repoMapContext) contextSources.push({ source: 'repo_map', text: repoMapContext });
  if (projectContext) contextSources.push({ source: 'project_context', text: `\n# Project Context\n${projectContext}` });
  if (memoryContext) contextSources.push({ source: 'memory', text: memoryContext });
  if (opts.autoApprove) {
    contextSources.push({
      source: 'non_interactive',
      text: `
# Non-Interactive Mode (Auto-Approve Active)
- **YOU HAVE UNLIMITED PERMISSION**: The user has run the tool with auto-approval enabled (-y / -yq).
- **DO NOT ASK FOR PERMISSION**: Do not ask the user "Would you like me to...", "Should I...", "Do you want me to...", or wait for instructions.
- **TAKE ACTION IMMEDIATELY**: Modify files, run shell commands, write patches, push commits, and complete the tasks autonomously.
- **DO NOT PROPOSE AND STOP**: If you know how to fix it, do it right now using the tools.
`,
    });
  }
  if (opts.sandbox?.enabled) {
    const info = opts.sandbox.getRunInfo();
    const egressDesc =
      info.egress === 'block_all'
        ? 'ALL network egress is blocked except loopback'
        : `network egress is restricted to the configured allowlist (${opts.sandbox.profile.egressRules
            .map((r) => `${r.match === 'suffix' ? '*.' : ''}${r.host}${r.port !== null ? `:${r.port}` : ''}`)
            .join(', ') || 'none'})`;
    contextSources.push({ source: 'sandbox', text: `
# Sandboxed Execution (Active)
- run_shell commands execute inside a sandbox boundary (${info.exec_mode} backend${info.degraded_reason ? ` — DEGRADED: ${info.degraded_reason}` : ''}).
- Filesystem: the workspace root is writable; paths outside the workspace are read-only unless sandbox.writablePaths grants access; permissions.denyPaths remain denied.
- Network: ${egressDesc}.
- Sandbox denials are reported as [SANDBOX_VIOLATION] tool errors — do NOT retry the blocked operation; choose an approach that stays inside the boundary.
` });
  }

  const budgeted = applyContextBudget(contextSources, resolveContextBudget());
  return { text: budgeted.texts.join('\n'), report: budgeted.report };
}

/**
 * Re-account (and re-trim) an existing system message under the current
 * budget — used when a restored/resumed history already carries a system
 * prompt and the cap may have shrunk since the original assembly (#422).
 */
export function rebudgetSystemMessage(content: string): SystemInjectionResult {
  const budgeted = applyContextBudget(
    [{ source: 'system', text: content }],
    resolveContextBudget(),
  );
  return { text: budgeted.texts.length > 0 ? budgeted.texts[0]! : content, report: budgeted.report };
}

/**
 * Oversized injections are never silent (#422): surface a visible warning,
 * a verbose detail line, and an audit event when the
 * SC_CONTEXT_BUDGET_TOKENS guard trimmed or dropped a source.
 */
export function emitContextBudgetWarning(
  report: ContextBudgetReport,
  log: (line: string) => void,
  audit: { contextBudget(report: ContextBudgetReport): void },
): void {
  if (!report.over_budget) return;
  const trims = formatContextBudgetTrims(report);
  log(
    `\n  ⚠️  Context budget ${report.budget_tokens} est. tokens exceeded ` +
    `(${report.requested_tokens} requested → ${report.injected_tokens} injected) — trimmed: ${trims}`
  );
  verbose(`[CONTEXT_BUDGET] ${JSON.stringify(report)}`, 2);
  audit.contextBudget(report);
}

/**
 * Tool outputs are a context source too (#422): accumulate their spend
 * in the report. The injection cap does not apply here — oversized
 * results are already trimmed by the >10KB auto-compressor (and older
 * entries by message compression/pruning) — `truncated` reflects that.
 */
export function accumulateToolOutputSpend(
  report: ContextBudgetReport | null,
  requestedTokens: number,
  injectedTokens: number,
): void {
  if (!report) return;
  let spend = report.sources.find(s => s.source === 'tool_outputs');
  if (!spend) {
    spend = { source: 'tool_outputs', tokens_requested: 0, tokens_injected: 0, truncated: false, dropped: false };
    report.sources.push(spend);
  }
  spend.tokens_requested += requestedTokens;
  spend.tokens_injected += injectedTokens;
  spend.truncated = spend.tokens_injected < spend.tokens_requested;
  report.requested_tokens += requestedTokens;
  report.injected_tokens += injectedTokens;
}
