# Architecture Overview

SC-Agent CLI (v0.4.2) is a provider-agnostic AI agent built with TypeScript, designed for
extensibility, security, and unattended (headless) automation. It speaks any
OpenAI-compatible Chat Completions API and runs a streaming, tool-using agent loop with
parallel tool execution.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User (CLI)                           │
│  - Subcommands: chat, doctor, resume, task, profile, init,  │
│    config, config-init, probe                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           v
┌─────────────────────────────────────────────────────────────┐
│              Chat Session / Agent Loop                       │
│              (src/commands/chat-session.ts,                  │
│               src/core/agent.ts + src/core/agent/*)          │
│  - Message history, compression, pruning, validation         │
│  - System-prompt assembly + context budget                   │
│  - Guards: empty-response, livelock, self-heal, completion   │
│  - Parallel tool execution (Promise.all, concurrency-capped) │
└──────────┬───────────────────────────────┬──────────────────┘
           │                               │
           v                               v
┌──────────────────────┐      ┌──────────────────────────────┐
│  Provider Layer      │      │  Tools Layer                 │
│  (src/core/provider) │      │  (src/tools/*)               │
│                      │      │                              │
│  - HTTP client       │      │  - read_file / write_file    │
│  - Streaming (SSE)   │      │  - edit_file / list_dir      │
│  - OpenAI-compatible │      │  - search_text / run_shell   │
│  - Failover cascade  │      │  - web_fetch / git           │
│                      │      │  - memory_read / memory_write│
│                      │      │  - code_query / mcp_validate │
│                      │      │  - repo_probe                │
│                      │      │  - MCP servers + plugins     │
└──────────┬───────────┘      └──────────┬───────────────────┘
           │                             │
           v                             v
┌──────────────────────┐      ┌──────────────────────────────┐
│  External API        │      │  Filesystem / Shell          │
│  - Ollama            │      │  - Read/write operations     │
│  - OpenAI            │      │  - Shell command execution   │
│  - Anthropic (proxy) │      │  - Path validation           │
│  - NVIDIA/Groq/...   │      │  - Permission checks         │
│  - Custom endpoints  │      │  - Optional sandbox          │
└──────────────────────┘      └──────────────────────────────┘
```

## Core Components

### `src/core` module index

| Module | Responsibility |
|--------|----------------|
| `agent.ts` | Orchestration-only agent loop; re-exports the history helpers + option types |
| `agent/*` | Loop subsystems: options, system-prompt, message-history, context-injection, audit, tool-execution, guards, checkpointing, run-outcome, events |
| `config.ts` | Hierarchical config load/save, profiles, and the workspace trust boundary (#469) |
| `provider.ts` | OpenAI-compatible client with streaming + failover contract |
| `failover.ts` | Timeout resolution, transient-error classification, backoff, `SC_FAILOVER` cascade |
| `message-validator.ts` | Repairs message-sequence errors and malformed tool-call arguments (#537) |
| `project-context.ts` | Loads `AGENTS.md`/`SC-AGENT.md`/`CLAUDE.md` (+ `settings.policyFile`) |
| `repo-map.ts` | Skeleton context mode — generated repo map (symbols + import edges) |
| `repo-probe/` | Toolchain/command detection backing `sc probe` |
| `roles.ts` | Multi-model planner/executor/reviewer routing + reviewer consensus loop (#424, #462) |
| `devcontainer.ts` | Optional `--devcontainer` execution with host fallback |
| `types.ts` | Shared TypeScript type definitions (messages, tools, config) |

### 1. CLI Layer (`src/cli.ts`)

Entry point using Commander.js. Defines commands:

- **`chat`**: Default command, starts an interactive session
- **`doctor`**: Preflight diagnostics — config, provider connectivity, API key, effective permissions
- **`resume`**: Resume the last interrupted session from a checkpoint
- **`task <subcommand>`**: Create/list tasks from templates (`create`, `list`, `templates`)
- **`profile <subcommand>`**: Manage model profiles (`list`, `add`, `use`, `remove`)
- **`init`**: Initialize a new project with `AGENTS.md`
- **`config`**: Show the current effective configuration
- **`config-init`**: Initialize the global config with default profiles
- **`probe [path]`**: Auto-detect toolchain, package manager, and build/test/lint commands
  (aliases: `repo-profile`, `repo-probe`)

### 2. Agent Layer (`src/core/agent.ts` + `src/core/agent/*`)

`src/core/agent.ts` is orchestration only; the subsystems live in `src/core/agent/`
(`options.ts`, `system-prompt.ts`, `message-history.ts`, `context-injection.ts`, `audit.ts`,
`tool-execution.ts`, `guards.ts`, `checkpointing.ts`, `run-outcome.ts`, `events.ts`). The
loop implements a **ReAct pattern**:

1. **Reason**: Send the message history + tool schemas to the provider
2. **Act**: Execute the tool calls returned by the model — **independent calls run in
   parallel** via `Promise.all`, capped by a concurrency limit (`tool-execution.ts`)
3. **Observe**: Add tool results to the message history
4. **Repeat**: Continue until the model stops calling tools

Key features:

- **System prompt injection**: default prompt, shell environment, persistent memory,
  project context, and (optionally) a generated repo map — assembled in
  `context-injection.ts` under the `SC_CONTEXT_BUDGET_TOKENS` guard
- **Streaming response handling**: incremental SSE deltas rendered as they arrive
- **Message validation** (`src/core/message-validator.ts`): repairs message-sequence
  errors and malformed `tool_calls[].function.arguments` before a request goes out
- **Compression & pruning** (`message-history.ts`): old tool outputs are compressed to
  structured summaries, then history is pruned to a bounded size
- **Guards** (`guards.ts`): empty-response, livelock, self-heal, zero-mutation, and
  Harmony/embedded-tool-call completion guards
- **Checkpointing** (`checkpointing.ts`): agent state auto-saved on a fixed cadence for
  crash recovery (`resume` / `/checkpoint`)
- **Audit events** (`audit.ts`) and a machine-readable **run manifest**
  (`src/utils/run-manifest.ts`) for headless batch runs
- Maximum iteration safety (prevents infinite loops)
- Error recovery (tool failures don't crash the loop)

### 3. Provider Layer (`src/core/provider.ts`)

Abstraction over the LLM API. Implements `OpenAICompatibleProvider`, which targets any
OpenAI-compatible Chat Completions endpoint:

- **Request format**: `/v1/chat/completions` (OpenAI Messages API)
- **Streaming**: Server-Sent Events (SSE) with incremental JSON deltas
- **Tool calling**: Native function calling via the `tools` parameter
- **Failover contract** (`src/core/failover.ts`): dual timeouts, bounded retry with
  backoff, and a provider/model cascade (`SC_FAILOVER`); a provider 400/422 rejecting the
  engine's own malformed `tool_calls[].function.arguments` classifies as `engine_protocol`
  and cascades rather than looping
- **Platform**: Uses Node.js native `fetch` (Node 18+; the package requires Node >= 20)

### 4. Tools Layer (`src/tools/*`)

Each tool implements the `Tool` interface:

```typescript
interface Tool {
  definition: ToolDefinition;  // JSON Schema sent to the model
  execute(args, ctx): Promise<string>;  // Execution logic
}
```

Tools receive a **ToolContext** with:

- `workspaceRoot`: Base directory for file operations
- `config`: Current configuration (for permissions)
- `autoApprove`: Override flag from the CLI

The built-in registry (`src/tools/registry.ts`) ships:

| Tool | Purpose |
|------|---------|
| `read_file` | Read file contents (supports `offset`/`limit` pagination) |
| `write_file` | Create/overwrite a file |
| `edit_file` | Apply a unified-diff patch |
| `list_dir` | List directory contents |
| `search_text` | Search text with glob patterns |
| `run_shell` | Execute a shell command (optional sandbox) |
| `web_fetch` | Fetch a URL (SSRF-guarded) |
| `git` | Native git operations (status, diff, log, branch, add, commit) |
| `memory_read` / `memory_write` | Persistent cross-session memory |
| `code_query` | Outline a source file's symbols |
| `mcp_validate` | Validate an MCP server's initialize handshake |
| `repo_probe` | Detect a repo's toolchain and commands |

**External tools**: MCP server tools (`src/mcp/*`) and plugin modules
(`src/tools/plugin-loader.ts`) are merged into the registry via `registerPluginTools()`
and routed through the same permission gate as built-ins.

**Security**: All file operations go through `resolveSafePath()`, which:

- Resolves relative paths to absolute
- Validates they're within the workspace
- Checks against deny patterns (`.env`, `*.key`, etc.)

### 5. Configuration System (`src/core/config.ts`)

Hierarchical config loading:

1. **Built-in defaults**: Defined in code
2. **Global config**: `~/.sc-agent/config.json` (or `SC_CONFIG_PATH` resolving outside the workspace)
3. **Project config**: `.sc-agent.json` in workspace — plus any config file whose realpath lands inside the workspace (#469)
4. **Active profile**: Overrides model settings

**Deep merging**: Later configs override earlier ones, but objects merge recursively (profiles accumulate, not replace).

**Workspace trust (#469)**: project-scope layers may only restrict. `mcp.servers`, `plugins`, `settings.formatters`, `model.baseUrl`/`apiKey`, `profiles.*.baseUrl`/`apiKey`, and `permissions.autoApprove` are dropped with a stderr warning + `config.privileged_key_blocked` audit event; `permissions.denyPaths`/`denyCommands` merge additively (global entries cannot be removed); while the baseline sandbox is enabled, project `sandbox.*` keys that would weaken it are dropped too.

### 6. Permission System (`src/utils/permissions.ts`)

Before executing a tool:

1. Check if `autoApprove` is set (from `-y` flag)
2. Check if tool is in `config.permissions.autoApprove` list
3. Otherwise, prompt user interactively

**Default auto-approved**: `read_file`, `list_dir`, `search_text`, `web_fetch`, `memory_read`
(read-only operations)

**Profiles**: Traditional (ask for every mutating tool), Blacklist (only dangerous
commands ask), and Custom. `denyCommands` and the unattended git-mutation guard run on a
normalized command form (#474); child processes get a scrubbed environment (#471); the
permission prompt's "Always" scope is capped at the session for mutating tools (#477).

### 7. Project Context (`src/core/project-context.ts`)

Searches for context files in this order:

1. `AGENTS.md`
2. `SC-AGENT.md`
3. `CLAUDE.md`
4. `settings.policyFile` (when configured)

If found, content is prepended to the system prompt. Allows projects to provide:

- Project overview
- Coding guidelines
- File structure explanation
- Build/test instructions

### 8. Memory (`src/utils/memory.ts`)

Cross-session persistent memory, stored under `~/.sc-agent/memory/`. Entries are
**workspace-scoped** by default (identity = `sha256(realpath(workspaceRoot)).slice(0,12)`);
a `global` tier is opt-in and shared. Other workspaces' entries are quarantined from every
read/write path (#476). The last 10 memories load into the system prompt with
`[memory:workspace]` / `[memory:global]` provenance tags.

### 9. Multi-Model Orchestration & Review (`src/core/roles.ts`)

Headless runs may route phases to different models via `config.roles`
(`planner`/`executor`/`reviewer`, using `provider/model` aliases) with a per-phase
read-only policy. A reviewer/judge consensus loop parses a `VERDICT:` marker, and a
`request_changes` verdict triggers bounded executor rework (#424, #462).

### 10. Sandbox (`src/utils/sandbox.ts`)

Opt-in `run_shell` sandboxing: a `bwrap` backend on Linux (mount/net namespaces +
`--seccomp`), and a degraded loopback egress-proxy mode elsewhere
(`src/utils/sandbox-proxy.ts`). Violations surface as `[SANDBOX_VIOLATION]` tool errors,
`sandbox_violation` audit events, and manifest fields.

## Data Flow

### Chat Session Flow

```
User input → Chat Session (REPL) → Agent.run()
  ↓
  Agent injects system prompt + shell env + memory + project context
  ↓
  Provider.chatCompletion(messages, tools)
  ↓
  Stream chunks → Display to user
  ↓
  Tool calls? → Execute each tool in parallel (with permission check)
  ↓
  Add tool results to messages
  ↓
  Loop back to Provider.chatCompletion() if more work needed
  ↓
  Final response → Return to REPL → Next user input
```

### Configuration Resolution

```
DEFAULT_CONFIG (in-memory)
  ↓
  Deep merge with ~/.sc-agent/config.json
  ↓
  Deep merge with ./.sc-agent.json (if exists)
  ↓
  Apply active profile overrides
  ↓
  Replace placeholder API keys with undefined
  ↓
  Validate required fields
  ↓
  Final config → Used by Agent
```

## Design Decisions

### Why streaming?

- **Responsiveness**: User sees output immediately
- **Long responses**: No timeout waiting for full completion
- **Better UX**: Feels like a conversation, not waiting for a batch

### Why parallel tool execution?

Independent tool calls are dispatched together with `Promise.all` (bounded by a
concurrency cap) instead of one at a time. This collapses the wall-clock cost of the
common "read several files / search several patterns" burst into a single round-trip.

### Why Commander.js?

- **Mature**: Battle-tested CLI framework
- **Ergonomic**: Clean API for defining commands
- **Cross-platform**: Works on Windows, Linux, macOS

## Extension Points

Want to add functionality? Here are the main extension points:

### Adding a New Tool

1. Create `src/tools/my-tool.ts`
2. Implement `Tool` interface
3. Add to `src/tools/registry.ts`

### Adding a New Provider

1. Create `src/core/my-provider.ts`
2. Implement same interface as `OpenAICompatibleProvider`
3. Wire it into the provider selection in `src/core/provider.ts`

### Adding a New Command

1. Create `src/commands/my-command.ts`
2. Register in `src/cli.ts` with Commander
3. Add it to autocomplete and `/help`

### Customizing Permissions

Edit `~/.sc-agent/config.json`:

```json
{
  "permissions": {
    "autoApprove": ["read_file", "write_file"],  // Add more tools
    "denyPaths": ["secrets/**", "*.env"]  // Block paths
  }
}
```

## Security Model

### Sandboxing

- **Workspace root**: All file operations confined to `workspaceRoot`
- **Path traversal**: `resolveSafePath` prevents `../../../etc/passwd`
- **Deny patterns**: Configurable blocklist (e.g., `.env`, `*.key`)
- **Optional sandbox**: `sandbox` config block for `run_shell` (see §10)

### Permission Model

- **Default deny**: Mutating operations require explicit permission
- **User control**: Interactive prompts for sensitive actions
- **Auto-approve**: Opt-in for trusted tools or with `-y` flag

### Audit Trail

- **Tool calls**: Logged to console with arguments
- **Results**: Success/failure displayed immediately
- **Errors**: Clear error messages, no silent failures
- **Structured audit**: `--audit-log` emits machine-readable events (e.g.
  `config.privileged_key_blocked`, `sandbox_violation`)

## Performance Considerations

### Streaming

- **Incremental rendering**: Chunks displayed as they arrive
- **Low latency**: First token appears in <1s (model-dependent)
- **Memory efficient**: No buffering of full response

### Concurrency

- **Single-threaded event loop**: Node.js handles async I/O
- **Parallel tools**: Independent tool calls execute concurrently via `Promise.all`,
  bounded by a concurrency cap (`src/core/agent/tool-execution.ts`)

### Context Management

- **Token tracking** (`src/utils/token-tracker.ts`): Estimates token usage and cost
- **Message compression**: Old tool outputs collapse to structured summaries before pruning
- **Context budget guard**: `SC_CONTEXT_BUDGET_TOKENS` trims over-budget prompt sources
  deterministically

## Testing Strategy

The suite runs on [vitest](https://vitest.dev/). Unit/integration tests live beside the
source as `src/**/*.test.ts`; CLI-level end-to-end smoke tests live in `test/e2e/` and
spawn the **built** `bin/sc.js` against a mock provider.

```bash
npm test            # Unit/integration suite (vitest run)
npm run test:watch  # Watch mode
npm run test:coverage
npm run test:e2e    # E2E smoke suite (requires `npm run build` first)
```

Layers covered:

1. **Unit tests**: Core logic (config merging, path validation, command normalization)
2. **Integration tests**: Tool execution against a mock provider
3. **E2E tests**: Full chat sessions via the built binary and a mock provider
4. **Docs-drift guards**: Tests that fail when docs fall out of sync with code
   (e.g. `src/env-docs.test.ts`, `src/devx.test.ts`)

A `.husky/pre-commit` hook runs `npx lint-staged` before every commit.

### Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR to `main`. The build-and-test matrix is:

| OS | Node versions |
|----|---------------|
| `ubuntu-latest` | 20, 22, 24, 26 |
| `windows-latest` | 22 |
| `macos-latest` | 22 |

Each job runs `npm ci` → `npm run build` → `npm test` → `npm run test:e2e` →
`npm run test:coverage`, then uploads the coverage report as an artifact.

## Deployment

### Local Development

```bash
npm install
npm run build
npm link
```

### Distribution

Options:

1. **npm package**: Publish to npm registry
2. **Binary**: Bundle with `pkg` or `nexe` (single executable)
3. **Container**: Docker image with Node + agent
4. **Standalone**: `npm pack` → tarball for offline install

## Roadmap Ideas

- [ ] Web UI (Electron or browser-based)
- [ ] Native Anthropic Messages API support (not just via proxy)
- [ ] Telemetry (opt-in usage metrics)
- [ ] Performance profiling (where does time go?)

## References

- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
- [Ollama OpenAI Compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md)
- [Commander.js Documentation](https://github.com/tj/commander.js)
- [Vitest Documentation](https://vitest.dev/)
- [Node.js Fetch API](https://nodejs.org/dist/latest-v22.x/docs/api/globals.html#fetch)
- [MCP Documentation](https://modelcontextprotocol.io/)
