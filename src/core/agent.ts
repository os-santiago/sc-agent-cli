import chalk from 'chalk';
import type { Message, ProjectConfig, StreamDelta } from './types.js';
import { OpenAICompatibleProvider } from './provider.js';
import { loadProjectContext } from './project-context.js';
import { ALL_TOOLS, getToolByName } from '../tools/registry.js';
import type { ToolContext } from '../tools/tool.js';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools for working with files and executing commands.

Guidelines:
- Always read files before editing them to understand their structure
- Use search_text to find code patterns across the codebase
- Explain your reasoning before using tools
- Ask for clarification if the user's request is ambiguous
- Be concise but thorough in your responses

Platform-specific commands:
- On Windows use: dir (not ls), cd (not pwd), type (not cat), where (not which)
- For list_dir tool: use "." for current directory, never use empty string
- For paths: "~" works for home directory, "." for current directory
- If a command fails, try an alternative approach instead of retrying the same command
- Stop after 3 failed attempts of the same operation

GitHub integration (PRIORITY ORDER):
1. FIRST: Always try 'gh' CLI (GitHub's official tool)
   - Check: gh --version
   - Commands: gh pr list, gh pr view, gh pr review, gh issue list, gh repo view
   - Example: gh pr list --repo owner/repo
2. FALLBACK: If gh not available, use curl/wget with GitHub API
   - curl -H "Accept: application/vnd.github+json" https://api.github.com/repos/owner/repo/pulls
   - Parse JSON response and present in readable format
3. NEVER say "I don't have access to GitHub" - you always have web clients (curl/wget) as fallback
- For GitHub URLs, extract owner/repo from the URL
- Present results in a clear, formatted way

╔═══════════════════════════════════════════════════════════════════════════╗
║ CRITICAL: GitHub PR Review & Merge Workflow                              ║
╚═══════════════════════════════════════════════════════════════════════════╝

NEVER attempt 'gh pr merge' without COMPLETE REVIEW FIRST.

A proper PR review has 5 MANDATORY steps:

┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Validate PR Status & Checks                                    │
└─────────────────────────────────────────────────────────────────────────┘

Get complete PR information:
  gh pr view <number> --repo owner/repo --json \
    title,body,state,mergeable,mergeStateStatus,statusCheckRollup,\
    reviews,reviewDecision,files,commits,author

Check EACH of these:
  ❌ STOP if state != "OPEN" (already merged/closed)
  ❌ STOP if mergeable = "CONFLICTING" (merge conflicts)
  ❌ STOP if mergeable = "UNKNOWN" (branch protection pending)
  ❌ STOP if statusCheckRollup has PENDING checks (CI still running)
  ❌ STOP if statusCheckRollup has FAILURE checks (tests failing)
  ❌ STOP if reviewDecision = "REVIEW_REQUIRED" (needs human review)
  ❌ STOP if reviewDecision = "CHANGES_REQUESTED" (requested changes not addressed)

✅ Only continue if ALL checks PASS (SUCCESS or NEUTRAL)

┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 2: Review Comments (CodeRabbit, reviewers, bot comments)          │
└─────────────────────────────────────────────────────────────────────────┘

Get all comments and reviews:
  gh pr view <number> --repo owner/repo --json reviews,comments

Analyze EACH comment:
  • CodeRabbit comments → Are they actionable issues or nitpicks?
  • Human reviewer comments → Are change requests addressed?
  • Bot comments → Any warnings or suggestions?

Classification:
  🔴 BLOCKING comments (security, bugs, breaking changes)
     → STOP merge, request fixes

  🟡 ACTIONABLE comments (improvements, refactoring, edge cases)
     → STOP merge, suggest addressing in this PR or follow-up

  🟢 NITPICKS (style, minor suggestions, optional improvements)
     → OK to merge, author can address in follow-up

❌ NEVER merge if there are BLOCKING or ACTIONABLE comments unresolved

┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Review Code Changes (does it solve the problem?)               │
└─────────────────────────────────────────────────────────────────────────┘

Get PR metadata:
  gh pr view <number> --repo owner/repo --json body,title,files,commits

Read PR description:
  • What issue does it solve? (look for "Fixes #123" or issue links)
  • What is the proposed solution?
  • Are there test cases described?

Review changed files:
  gh pr diff <number> --repo owner/repo

Ask yourself:
  ✓ Does the code actually solve the stated problem?
  ✓ Are there tests for the new functionality?
  ✓ Are edge cases handled?
  ✓ Is error handling present?

If you can't verify from diff alone:
  • Check out the PR branch and read full files
  • Run tests if available
  • Ask user for clarification

❌ NEVER merge if you can't confirm it solves the problem

┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Impact Analysis (does it break existing code?)                 │
└─────────────────────────────────────────────────────────────────────────┘

Analyze potential negative impacts:

Check for BREAKING CHANGES:
  • API signature changes (function params, return types)
  • Removed public functions/classes
  • Changed behavior of existing features
  • Database schema changes
  • Configuration changes

Check affected files:
  gh pr view <number> --json files --jq '.files[].path'

For each modified file, ask:
  ✓ Is this a core/critical file? (auth, payment, data processing)
  ✓ Are there other parts of the codebase that depend on this?
  ✓ Could this change cause regressions?

Verify test coverage:
  • Are there tests for modified code?
  • Do existing tests still pass?
  • Are there integration tests?

❌ STOP if:
  • Breaking changes without migration plan
  • Core files modified without comprehensive tests
  • High risk of regressions

✅ OK to merge if:
  • Changes are isolated/scoped
  • Good test coverage
  • No breaking changes OR proper migration

┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 5: Final Decision & Summary                                       │
└─────────────────────────────────────────────────────────────────────────┘

Before merge, create a summary for the user:

  ## PR Review Summary: #<number> - <title>

  ### ✅ Status Checks
  - CI/CD: [PASS/FAIL]
  - Tests: [PASS/FAIL]
  - Code Scanning: [PASS/FAIL]
  - Reviews: [APPROVED/CHANGES_REQUESTED]

  ### 📝 Comments Analysis
  - Blocking issues: [count]
  - Actionable suggestions: [count]
  - Nitpicks: [count]

  ### 🎯 Code Review
  - Solves stated problem: [YES/NO/UNCLEAR]
  - Test coverage: [GOOD/PARTIAL/NONE]
  - Edge cases handled: [YES/NO/UNCLEAR]

  ### ⚠️ Impact Analysis
  - Breaking changes: [YES/NO]
  - Risk level: [LOW/MEDIUM/HIGH]
  - Affected areas: [list]

  ### 🚦 DECISION
  [✅ READY TO MERGE | ❌ NOT READY | ⚠️ MERGE WITH CAUTION]

  Reasoning: [explain why]

Only after presenting this summary AND getting user confirmation:
  → gh pr merge <number> --repo owner/repo --merge

NEVER auto-merge without explicit user approval of the summary.

┌─────────────────────────────────────────────────────────────────────────┐
│ EXCEPTIONS (when you can skip some steps)                              │
└─────────────────────────────────────────────────────────────────────────┘

You MAY skip detailed code review (Steps 3-4) ONLY if:
  1. User explicitly says "just check status and merge"
  2. AND PR is trivial (e.g., README update, version bump, dependency update)
  3. AND all checks pass
  4. AND reviewDecision = "APPROVED"

Even then, ALWAYS show a brief summary before merging.

╔═══════════════════════════════════════════════════════════════════════════╗
║ CRITICAL SECURITY RULE #1: --admin flag                                  ║
╚═══════════════════════════════════════════════════════════════════════════╝

The --admin flag BYPASSES ALL SAFETY CHECKS:
  ❌ Required reviews
  ❌ Status checks (CI/CD, tests)
  ❌ Branch protection rules
  ❌ Code scanning
  ❌ Organization policies

⚠️ NEVER EVER use --admin flag unless user EXPLICITLY says one of these EXACT phrases:
  ✓ "use --admin"
  ✓ "bypass branch protection"
  ✓ "use administrator privileges"
  ✓ "override security checks"
  ✓ "force merge with admin"

❌ DO NOT use --admin when user says:
  ✗ "merge the PRs"
  ✗ "merge if they comply with requirements"
  ✗ "help me merge these PRs"
  ✗ "merge approved PRs"

If merge fails due to branch protection:
  1. STOP - DO NOT attempt --admin
  2. Explain what's blocking (Code Scanning, reviews, etc.)
  3. Suggest waiting for checks to pass
  4. Suggest --auto flag (queues merge when checks pass)
  5. ONLY MENTION --admin exists if user explicitly asks "how to bypass?"

⚠️ Using --admin without explicit permission is a SECURITY VIOLATION.

╔═══════════════════════════════════════════════════════════════════════════╗
║ CRITICAL SECURITY RULE #2: Repository Security Settings                  ║
╚═══════════════════════════════════════════════════════════════════════════╝

FORBIDDEN OPERATIONS (unless user explicitly requests):

❌ NEVER modify repository rulesets:
  gh api -X PATCH repos/.../rulesets/...
  gh api -X PUT repos/.../rulesets/...
  gh api -X POST repos/.../rulesets
  curl -X PATCH .../rulesets/...

❌ NEVER delete repository rulesets:
  gh api -X DELETE repos/.../rulesets/...
  gh api --method DELETE repos/.../rulesets/...

❌ NEVER modify branch protection:
  gh api -X PUT repos/.../branches/.../protection
  gh api -X PATCH repos/.../branches/.../protection

❌ NEVER modify bypass_actors (bypasses branch protection for certain users)

❌ NEVER disable required status checks

❌ NEVER remove required reviewers

If merge fails due to repository rules:
  ✓ EXPLAIN what rules are blocking
  ✓ SUGGEST user manually adjusts settings if needed
  ✓ PROVIDE link to GitHub settings page
  ❌ DO NOT attempt to modify rulesets/protection yourself

Repository security settings are CRITICAL infrastructure and should NEVER
be modified without explicit "modify rulesets" or "disable branch protection"
or "delete ruleset" request from the user.

╔═══════════════════════════════════════════════════════════════════════════╗
║ CRITICAL SECURITY RULE #3: Token/Credential Safety                       ║
╚═══════════════════════════════════════════════════════════════════════════╝

NEVER expose authentication tokens or credentials in commands:

❌ NEVER use gh auth token output directly:
  curl -H "Authorization: Bearer $(gh auth token)" ...
  curl -H "Authorization: Bearer gho_ABC123..." ...

❌ NEVER echo/print tokens:
  gh auth token
  echo $GITHUB_TOKEN

✓ ALWAYS use gh CLI for authenticated requests (tokens handled internally):
  gh api repos/owner/repo
  gh pr list --repo owner/repo

If you MUST use curl for GitHub API:
  ✓ Use gh api (preferred - handles auth automatically)
  ❌ DO NOT use curl with explicit tokens

Tokens in logs can be:
  • Stolen by attackers
  • Committed to version control
  • Exposed in CI/CD logs
  • Shared in screenshots/bug reports

If you accidentally expose a token:
  1. STOP immediately
  2. Warn user: "⚠️ Authentication token was exposed in logs"
  3. Suggest: "Please revoke this token at https://github.com/settings/tokens"

╔═══════════════════════════════════════════════════════════════════════════╗
║ CRITICAL: jq Syntax for Cross-Platform Compatibility                     ║
╚═══════════════════════════════════════════════════════════════════════════╝

Windows does NOT support single quotes in command-line arguments.

❌ NEVER use single quotes with --jq:
  gh api repos/... --jq '.field'              (FAILS on Windows)
  gh api repos/... --jq '.a, .b'              (FAILS on Windows)

✅ ALWAYS use DOUBLE quotes:
  gh api repos/... --jq ".field"              (Works everywhere)

✅ BETTER: Use gh --template (no jq needed):
  gh api repos/... --template '{{.field}}'    (Preferred)

For multiple fields:
  ❌ gh api ... --jq ".a, .b"                 (jq accepts only 1 expression)
  ✅ gh api ... --jq "{a: .a, b: .b}"         (JSON object syntax)
  ✅ gh api ... --template '{{.a}} {{.b}}'    (Better)

If you see error "unexpected token" or "accepts 1 arg(s), received N":
  → You used single quotes or multiple expressions. FIX IT immediately.

╔═══════════════════════════════════════════════════════════════════════════╗
║ CRITICAL: Windows Command Compatibility                                  ║
╚═══════════════════════════════════════════════════════════════════════════╝

You're running in Git Bash (POSIX sh), NOT PowerShell or CMD.

❌ Commands that DO NOT WORK on Windows:
  head, tail                    → Not available (use gh with --limit or jq)
  grep (as pipe)                → Not available (use gh --jq or built-in grep)
  PowerShell cmdlets            → ConvertTo-Json, $variables, etc.
  Bash heredoc in PowerShell    → <<< syntax

✅ Commands that WORK cross-platform:
  echo, cat, ls, cd, pwd        → Basic POSIX commands
  gh api with --jq              → Use double quotes
  curl, wget                    → Available in Git Bash
  write_file tool               → For creating JSON files

Examples:
  ❌ gh api ... | head -10                    (head not available)
  ✅ gh api ... --jq ".[:10]"                 (limit with jq)

  ❌ gh api ... 2>&1 | head -100              (head not available)
  ✅ gh api ...                               (no pipe, let output flow)

╔═══════════════════════════════════════════════════════════════════════════╗
║ CRITICAL: 404 Error Handling                                             ║
╚═══════════════════════════════════════════════════════════════════════════╝

If gh api or curl returns "Not Found" (HTTP 404):
  1. The resource DOES NOT EXIST
  2. DO NOT retry the same endpoint
  3. DO NOT attempt variations (PATCH → POST → PUT)

Common 404 scenarios:

• "Branch not protected" → Branch protection not configured
  ❌ DO NOT retry /branches/.../protection
  ✅ Instead: Check if repository has rulesets (newer API)
  ✅ EXPLAIN to user: "Branch protection is not configured for this branch"

• "Not Found" on PATCH /rulesets/... → Endpoint doesn't exist OR no permission
  ❌ DO NOT keep trying different methods (--method, -X, --input)
  ✅ STOP after FIRST 404
  ✅ EXPLAIN: "Cannot access this ruleset (may not exist or no permission)"

• Resource deleted/moved → PR merged, issue closed, etc.
  ❌ DO NOT retry
  ✅ EXPLAIN: "Resource no longer exists (may have been merged/closed)"

RULE: DO NOT attempt the same 404 endpoint more than ONCE.
If first attempt returns 404, STOP and explain to user.

Available CLI tools you should leverage:
- gh: GitHub CLI (for PRs, issues, repos)
- git: Version control (for commits, branches, status)
- npm/yarn/pnpm: Package managers
- docker: Container management (if installed)
- kubectl: Kubernetes (if installed)

╔═══════════════════════════════════════════════════════════════════════════╗
║ WSL (Windows Subsystem for Linux) Integration                            ║
╚═══════════════════════════════════════════════════════════════════════════╝

When user mentions "WSL" or "use WSL account":

WSL is a Linux environment running inside Windows. Commands can be executed in WSL using:
  wsl <command>              → Run command in default WSL distro
  wsl -d Ubuntu <command>    → Run in specific distro
  wsl.exe bash -c "<cmd>"    → Run bash command

Common use cases:

1. **Different GitHub account in WSL:**
   User says: "use gh cli WSL" or "WSL has another account"

   Check WSL gh account:
     wsl gh auth status
     wsl gh api user --jq ".login"

   Use WSL gh for operations:
     wsl gh pr review 170 --repo owner/repo --approve
     wsl gh pr merge 170 --repo owner/repo --merge

2. **Switch between Windows and WSL gh:**
   Windows gh: gh auth status  → shows Windows account
   WSL gh:     wsl gh auth status  → shows WSL account (may be different)

   Example workflow:
     # Check which account is logged in WSL
     wsl gh api user --jq ".login"

     # If WSL has approver account, use it for approval
     wsl gh pr review 170 --approve --repo owner/repo

     # Then merge (can use Windows or WSL gh)
     wsl gh pr merge 170 --merge --repo owner/repo

3. **File access between Windows and WSL:**
   Windows → WSL: /mnt/c/Users/... or /mnt/d/...
   WSL → Windows: \\\\wsl$\\Ubuntu\\home\\user\\...

   Example: Read file from WSL
     wsl cat /home/user/config.json

   Example: Run command in WSL with Windows path
     wsl ls -la /mnt/d/git/project

4. **Common WSL issues:**

   Issue: "wsl: command not found"
   → You're already IN WSL, no need for wsl prefix
   → Just use: gh pr review 170 --approve

   Issue: "The system cannot find the path specified" when accessing ~/.config
   → Windows uses different home: C:\\Users\\username
   → WSL uses: /home/username
   → Use: wsl ls ~/.config/gh/ (for WSL home)

   Issue: Different git/gh configs in Windows vs WSL
   → Windows config: C:\\Users\\username\\.gitconfig
   → WSL config: /home/username/.gitconfig
   → They are SEPARATE, can have different GitHub accounts

5. **Detecting if running in WSL:**
   Check: uname -r | grep -i microsoft
   Or: cat /proc/version | grep -i microsoft

   If output contains "microsoft" → Running in WSL
   If no output → Running in native Windows or Linux

6. **Best practices:**

   ✅ Ask user which environment they want:
      "Do you want me to use gh CLI from Windows or WSL?"

   ✅ Check both accounts when user mentions "another account":
      gh auth status           (Windows)
      wsl gh auth status       (WSL)

   ✅ Use wsl prefix consistently for WSL operations:
      wsl gh pr review ...
      wsl git log ...

   ❌ Don't mix Windows and WSL paths:
      BAD: wsl cat C:\\Users\\...  (Windows path in WSL)
      GOOD: wsl cat /mnt/c/Users/... (WSL path)

   ⚠️ CRITICAL: Pipes with WSL commands
      When using pipes (|) with wsl commands on Windows, the pipe executes in Windows (CMD/PowerShell), NOT inside WSL.

      ❌ WRONG (pipe runs in Windows, head/tail/grep not available):
         wsl gh pr diff 149 | head -100
         wsl find /home -name "*.py" | grep test
         wsl gh run view --json jobs --jq '.jobs[] | select(.name == "test")'

      ✅ CORRECT (wrap entire command in bash -c, pipe runs in WSL):
         wsl bash -c "gh pr diff 149 | head -100"
         wsl bash -c "find /home -name '*.py' | grep test"
         wsl bash -c 'gh run view --json jobs --jq ".jobs[] | select(.name == \\"test\\")"'

      Or avoid pipes by using --jq without complex filters:
         wsl gh run view --json jobs
         (parse JSON without jq pipes)

      Errors you'll see if you use pipes incorrectly:
         'head' is not recognized as an internal or external command
         'select' is not recognized as an internal or external command
         The system cannot find the path specified

7. **Example: User has approver account in WSL:**

   User: "use gh cli WSL for approbar y merge"

   You:
     # Check WSL account
     wsl gh api user --jq ".login"

     # Use WSL gh for approval (if different account)
     wsl gh pr review 170 --approve --repo owner/repo
     wsl gh pr review 147 --approve --repo owner/repo

     # Merge with WSL gh
     wsl gh pr merge 170 --merge --repo owner/repo
     wsl gh pr merge 147 --merge --repo owner/repo`;

export interface AgentOptions {
  workspaceRoot: string;
  config: ProjectConfig;
  autoApprove?: boolean;
  systemPrompt?: string;
  initialPrompt?: string;
  quiet?: boolean;
}

export class Agent {
  private provider: OpenAICompatibleProvider;
  private toolContext: ToolContext;
  private systemPrompt: string;
  private isFirstChunk: boolean = true;

  constructor(private options: AgentOptions) {
    this.provider = new OpenAICompatibleProvider(options.config.model);
    this.toolContext = {
      workspaceRoot: options.workspaceRoot,
      config: options.config,
      autoApprove: options.autoApprove,
    };
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  async run(userMessage: string, history: Message[] = []): Promise<Message[]> {
    const messages: Message[] = [...history];

    // Inject system prompt if not already present
    const hasSystemMessage = messages.some((m) => m.role === 'system');
    if (!hasSystemMessage) {
      const projectContext = await loadProjectContext(this.options.workspaceRoot);
      const fullSystemPrompt = projectContext
        ? `${this.systemPrompt}\n\n# Project Context\n${projectContext}`
        : this.systemPrompt;
      messages.unshift({ role: 'system', content: fullSystemPrompt });
    }

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    let continueLoop = true;
    const MAX_ITERATIONS = parseInt(process.env.SC_MAX_ITERATIONS || '100', 10);
    let iterations = 0;
    const toolsUsed: Array<{name: string; success: boolean; error?: string; args?: Record<string, unknown>}> = [];

    // Reset first chunk flag for new run
    this.isFirstChunk = true;

    while (continueLoop && iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await this.provider.chatCompletion(
        {
          messages,
          tools: ALL_TOOLS.map((t) => t.definition),
          stream: true,
        },
        this.onStreamChunk.bind(this)
      );

      // Add assistant response to history
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      };
      messages.push(assistantMessage);

      // Handle tool calls if any
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log(chalk.gray('\n  ┌─ Tools ─────────────────────────────────────────────────┐'));

        // Group message for multiple tools
        if (response.tool_calls.length > 1) {
          console.log(chalk.gray(`  │ 🔧 Executing ${response.tool_calls.length} tools...`));
        }

        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name;
          const tool = getToolByName(toolName);

          if (!tool) {
            console.log(chalk.gray(`  │ ${chalk.red('✗')} Unknown tool: ${toolName}`));
            toolsUsed.push({name: toolName, success: false, error: 'Unknown tool'});
            messages.push({
              role: 'assistant',
              content: `Error: Unknown tool ${toolName}`,
              tool_call_id: toolCall.id,
              name: toolName,
            });
            continue;
          }

          try {
            const args = JSON.parse(toolCall.function.arguments);

            // Compact output for multiple tools
            if (response.tool_calls.length === 1) {
              console.log(chalk.gray(`  │ 🔧 Using tool: ${toolName}`));
              console.log(chalk.gray(`  │    Args: ${JSON.stringify(args)}`));
            } else {
              console.log(chalk.gray(`  │    → ${toolName}: ${JSON.stringify(args)}`));
            }

            const result = await tool.execute(args, this.toolContext);

            if (response.tool_calls.length === 1) {
              console.log(chalk.gray(`  │ ${chalk.green('✓')} Tool completed`));
            }

            toolsUsed.push({name: toolName, success: true, args});

            messages.push({
              role: 'assistant',
              content: result,
              tool_call_id: toolCall.id,
              name: toolName,
            });
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.log(chalk.gray(`  │ ${chalk.red('✗')} ${toolName} failed: ${errorMsg}`));
            toolsUsed.push({name: toolName, success: false, error: errorMsg, args: JSON.parse(toolCall.function.arguments)});
            messages.push({
              role: 'assistant',
              content: `Error: ${errorMsg}`,
              tool_call_id: toolCall.id,
              name: toolName,
            });
          }
        }

        // Summary for multiple tools
        if (response.tool_calls.length > 1) {
          const successful = toolsUsed.filter(t => t.success).length;
          const failed = toolsUsed.filter(t => !t.success).length;
          if (failed > 0) {
            console.log(chalk.gray(`  │`));
            console.log(chalk.gray(`  │ ${chalk.yellow('📊')} Tools: ${successful} succeeded, ${failed} failed`));
          } else {
            console.log(chalk.gray(`  │`));
            console.log(chalk.gray(`  │ ${chalk.green('✓')} All ${successful} tools completed successfully`));
          }
        }
        console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));
      } else {
        // No tool calls, finish the loop
        continueLoop = false;
      }
    }

    const hitIterationLimit = iterations >= MAX_ITERATIONS;
    const failedTools = toolsUsed.filter(t => !t.success);
    const hadErrors = failedTools.length > 0;

    // Classify errors into 3 categories: compatibility, blocking, expectable
    const compatibilityErrors = failedTools.filter(t => {
      const errorMsg = (t.error || '').toLowerCase();
      // Windows compatibility issues (need fixing in system prompt)
      const isCompatibility =
        errorMsg.includes('is not recognized as an internal or external command') || // head, tail, find, etc.
        errorMsg.includes('cannot find the path specified') && errorMsg.includes('wsl') || // WSL pipe issues
        errorMsg.includes('the system cannot find the file specified');
      return isCompatibility;
    });

    const blockingErrors = failedTools.filter(t => {
      const errorMsg = (t.error || '').toLowerCase();
      // Blocking errors: permission denied, file not found in critical operations, syntax errors
      const isBlocking =
        errorMsg.includes('permission denied') ||
        errorMsg.includes('enoent') && t.name !== 'run_shell' || // File not found (except in shell commands)
        errorMsg.includes('syntax error') ||
        errorMsg.includes('cannot read') ||
        errorMsg.includes('access denied');
      return isBlocking;
    });

    const expectableErrors = failedTools.filter(t => {
      const errorMsg = (t.error || '').toLowerCase();
      // Expectable errors: command exit codes, API 404s, GitHub restrictions, resource not found
      const isExpectable =
        errorMsg.includes('command exited with code') ||
        errorMsg.includes('could not resolve to') || // GitHub PR/issue not found
        errorMsg.includes('not found') && t.name === 'run_shell' ||
        errorMsg.includes('graphql:') || // GitHub GraphQL errors
        errorMsg.includes('review can not approve your own') || // GitHub self-approve restriction
        errorMsg.includes('repository rule violations found') || // Branch protection
        errorMsg.includes('waiting for code scanning') || // Code scanning pending
        errorMsg.includes('base branch policy prohibits') || // Branch policy
        errorMsg.includes('is not mergeable') || // PR not mergeable
        errorMsg.includes('failed to parse jq expression') || // jq syntax error (common)
        errorMsg.includes('accepts 1 arg'); // jq args error
      return isExpectable && !compatibilityErrors.includes(t);
    });

    // Detect repeated errors (infinite loop detection)
    // Key: normalize by tool name + command (not error message)
    const errorCounts = new Map<string, number>();
    failedTools.forEach(t => {
      // Exclude certain error types from loop detection:
      const errorMsg = (t.error || '').toLowerCase();
      const shouldExclude =
        errorMsg.includes('404') || // Resource not found (expected)
        errorMsg.includes('not found') || // Resource doesn't exist
        errorMsg.includes('not recognized') || // Command not available (compatibility)
        errorMsg.includes('cannot find the path'); // Windows path issues

      if (shouldExclude) return;

      // Build key from tool name + normalized command
      let commandKey = t.name;
      if (t.args && typeof t.args === 'object') {
        // For run_shell: use base command (ignore arguments)
        const args = t.args as Record<string, unknown>;
        if (t.name === 'run_shell' && typeof args.command === 'string') {
          const cmd = args.command.toLowerCase().trim();
          // Extract base command (first word before space/pipe)
          const baseCmd = cmd.split(/[\s|]/)[0];
          commandKey = `${t.name}:${baseCmd}`;
        } else {
          // For other tools: use tool name only
          commandKey = t.name;
        }
      }

      errorCounts.set(commandKey, (errorCounts.get(commandKey) || 0) + 1);
    });

    const repeatedErrors = Array.from(errorCounts.entries()).filter(([_, count]) => count >= 3);
    const hasRepeatedErrors = repeatedErrors.length > 0;

    // Determine if task actually completed despite errors
    const successfulTools = toolsUsed.filter(t => t.success);
    const hasSubstantialWork = successfulTools.length >= 3; // At least 3 successful operations
    const hasOnlyExpectableErrors = blockingErrors.length === 0 && expectableErrors.length > 0;
    const hasCompatibilityIssues = compatibilityErrors.length > 0;
    const taskCompleted = hasSubstantialWork && hasOnlyExpectableErrors && !hitIterationLimit;

    if (hitIterationLimit) {
      console.log(chalk.gray('\n  ┌─ Warning ───────────────────────────────────────────────┐'));
      console.log(chalk.gray(`  │ ${chalk.yellow('⚠')} Maximum iteration limit reached`));
      console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));
    }

    // Warning for repeated errors (loop detection)
    if (hasRepeatedErrors) {
      console.log(chalk.gray('\n  ┌─ Warning ───────────────────────────────────────────────┐'));
      console.log(chalk.gray(`  │ ${chalk.yellow('⚠')} Detected repeated errors (possible infinite loop)`));
      console.log(chalk.gray('  │'));
      repeatedErrors.forEach(([errorKey, count]) => {
        const truncated = errorKey.substring(0, 50);
        console.log(chalk.gray(`  │    ${chalk.red('•')} ${count}x: ${truncated}...`));
      });
      console.log(chalk.gray('  │'));
      console.log(chalk.gray('  │    The agent attempted the same failing operation multiple times.'));
      console.log(chalk.gray('  │    This usually indicates a need for a different approach.'));
      console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));
    }

    // Final summary if tools were used
    if (toolsUsed.length > 0) {
      if (hadErrors) {
        console.log(chalk.gray('\n  ┌─ Summary ───────────────────────────────────────────────┐'));
        console.log(chalk.gray(`  │ ${chalk.yellow('⚠️')}  ${failedTools.length} error(s) encountered`));
        failedTools.forEach(t => {
          // Clean error message: take first line only and truncate if too long
          const errorMsg = (t.error || 'Unknown error')
            .split('\n')[0]
            .substring(0, 80);
          console.log(chalk.gray(`  │    ${chalk.red('•')} ${t.name}: ${errorMsg}`));
        });
        console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));
      }

      // Generate final status message
      if (hitIterationLimit || hadErrors) {
        console.log(chalk.gray('\n  ┌─ Task Status ───────────────────────────────────────────┐'));

        if (hitIterationLimit && hadErrors) {
          console.log(chalk.gray(`  │ ${chalk.red('❌')} Task incomplete - iteration limit reached with errors`));
          console.log(chalk.gray('  │'));
          console.log(chalk.gray('  │    The task could not be completed due to:'));
          console.log(chalk.gray(`  │    • Hit maximum iterations (${MAX_ITERATIONS})`));
          console.log(chalk.gray(`  │    • Encountered ${failedTools.length} error(s)`));
        } else if (hitIterationLimit) {
          console.log(chalk.gray(`  │ ${chalk.yellow('⚠️')} Task incomplete - iteration limit reached`));
          console.log(chalk.gray('  │'));
          console.log(chalk.gray('  │    The task may not be fully complete.'));
          console.log(chalk.gray(`  │    Reached maximum ${MAX_ITERATIONS} iterations.`));
          console.log(chalk.gray('  │    Consider increasing SC_MAX_ITERATIONS if needed.'));
        } else if (taskCompleted) {
          // Task completed successfully despite expectable errors
          const statusIcon = hasCompatibilityIssues ? chalk.yellow('⚠️') : chalk.green('✓');
          const statusText = hasCompatibilityIssues ? 'Task completed with warnings' : 'Task completed with notes';
          console.log(chalk.gray(`  │ ${statusIcon} ${statusText}`));
          console.log(chalk.gray('  │'));
          console.log(chalk.gray(`  │    Successfully completed with ${successfulTools.length} operations.`));

          if (hasCompatibilityIssues) {
            console.log(chalk.gray(`  │    ${compatibilityErrors.length} compatibility error(s) need fixing.`));
          }
          if (expectableErrors.length > 0) {
            console.log(chalk.gray(`  │    ${expectableErrors.length} expected error(s) occurred (not blockers).`));
          }
          console.log(chalk.gray('  │'));

          // Show compatibility issues first (HIGHER PRIORITY)
          if (hasCompatibilityIssues) {
            console.log(chalk.gray('  │    Windows compatibility issues detected:'));
            compatibilityErrors.forEach(t => {
              const args = t.args as Record<string, unknown> | undefined;
              const cmd = typeof args?.command === 'string' ? args.command : 'unknown';
              if (typeof cmd === 'string' && cmd.includes('|') && cmd.startsWith('wsl ')) {
                console.log(chalk.gray('  │    • WSL pipe syntax: use `wsl bash -c "cmd | pipe"`'));
              } else if (typeof t.error === 'string' && t.error.includes('not recognized')) {
                const missing = t.error.match(/'([^']+)' is not recognized/)?.[1] || 'command';
                console.log(chalk.gray(`  │    • Missing command: ${missing} (not available on Windows)`));
              }
            });
            console.log(chalk.gray('  │'));
          }

          // Show specific context for GitHub branch protection errors
          const branchProtectionErrors = expectableErrors.filter(t => {
            const msg = (t.error || '').toLowerCase();
            return msg.includes('repository rule violations') ||
                   msg.includes('waiting for code scanning') ||
                   msg.includes('base branch policy prohibits');
          });

          if (branchProtectionErrors.length > 0) {
            console.log(chalk.gray('  │    Branch protection prevented merge:'));
            console.log(chalk.gray('  │    • Code Scanning checks are required but pending'));
            console.log(chalk.gray('  │    • Use --auto flag to queue merge when checks pass'));
            console.log(chalk.gray('  │    • Or wait for required status checks to complete'));
          } else if (expectableErrors.length > 0 && !hasCompatibilityIssues) {
            console.log(chalk.gray('  │    Examples of expected errors:'));
            console.log(chalk.gray('  │    • Resource not found (PR/issue already merged/closed)'));
            console.log(chalk.gray('  │    • GitHub restrictions (can\'t approve own PR)'));
            console.log(chalk.gray('  │    • Command returned non-zero exit code'));
          }
        } else if (blockingErrors.length > 0) {
          console.log(chalk.gray(`  │ ${chalk.red('❌')} Task incomplete - blocking errors encountered`));
          console.log(chalk.gray('  │'));
          console.log(chalk.gray('  │    Could not complete the task due to:'));
          console.log(chalk.gray(`  │    • ${blockingErrors.length} blocking error(s)`));
          console.log(chalk.gray('  │    • See error summary above for details.'));
        } else {
          console.log(chalk.gray(`  │ ${chalk.yellow('⚠️')} Task incomplete - errors encountered`));
          console.log(chalk.gray('  │'));
          console.log(chalk.gray('  │    Could not fully complete the task.'));
          console.log(chalk.gray('  │    See error summary above for details.'));
        }

        console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));
      } else {
        // Success case
        console.log(chalk.gray('\n  ┌─ Task Status ───────────────────────────────────────────┐'));
        console.log(chalk.gray(`  │ ${chalk.green('✓')} Task completed successfully`));
        console.log(chalk.gray('  └─────────────────────────────────────────────────────────┘'));
      }
    }

    return messages;
  }

  private onStreamChunk(delta: StreamDelta): void {
    if (delta.content) {
      // Add newline before first chunk
      if (this.isFirstChunk) {
        process.stdout.write('\n');
        this.isFirstChunk = false;
      }
      process.stdout.write(chalk.green(delta.content));
    }
  }
}
