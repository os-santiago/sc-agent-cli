# SC-Agent CLI - Agent Instructions

## Project Overview

**SC-Agent CLI** (v0.5.0) is a provider-agnostic AI agent CLI tool that supports any OpenAI-compatible API (OpenAI, Anthropic, Ollama, LM Studio, NVIDIA, Groq, Together, etc.). It provides:
- **10+ built-in tools** (web fetch, git, file ops, shell, persistent memory)
- **Parallel tool execution** for maximum performance
- **Smart permission profiles** (Traditional, Blacklist, Custom)
- **Cross-platform** (Windows, macOS, Linux, WSL)
- **Cross-session persistent memory**
- **Shell environment auto-detection**
- **Streaming responses** with status bar UI

## Key Architecture

### Core Components

- **`src/core/types.ts`**: TypeScript type definitions (messages, tools, config)
- **`src/core/config.ts`**: Configuration loading/saving with profile support
- **`src/core/provider.ts`**: OpenAI-compatible API client with streaming
- **`src/core/agent.ts`**: Main agent loop with parallel tool execution & memory injection
- **`src/core/project-context.ts`**: Loads project-specific context from `AGENTS.md|CLAUDE.md`
- **`src/core/message-validator.ts`**: Auto-corrects message sequence errors

### Tools System (10 tools)

- **`src/tools/tool.ts`**: Tool interface and context
- **`src/tools/registry.ts`**: Central registry of all available tools
- File operation tools:
  - `read-file.ts`: Read file contents (auto-approved)
  - `write-file.ts`: Create/overwrite files (requires permission)
  - `edit-file.ts`: Apply unified diff patches (requires permission)
  - `list-dir.ts`: List directory contents (auto-approved)
  - `search-text.ts`: Search text with glob patterns (auto-approved)
- Execution tools:
  - `run-shell.ts`: Execute shell commands (requires permission)
- **New in v0.4.0**:
  - `web-fetch.ts`: Fetch web content (docs, APIs, GitHub). No API key needed. (auto-approved)
  - `git-tool.ts`: Native git operations (status, diff, log, branch, add, commit) (requires permission)
  - `memory-tools.ts`: Persistent cross-session memory read/write (read auto-approved, write requires permission)

### Utilities

- **`src/utils/permissions.ts`**: Permission request system (Traditional + Blacklist profiles)
- **`src/utils/path-security.ts`**: Path validation and sandboxing
- **`src/utils/memory.ts`**: Persistent cross-session memory storage (JSON file in ~/.sc-agent/memory/)
- **`src/utils/shell-env.ts`**: Shell environment auto-detection (cmd, PowerShell, Git Bash, WSL)
- **`src/utils/dangerous-commands.ts`**: Dangerous command detection for Blacklist profile
- **`src/utils/autocomplete.ts`**: Tab completion for commands, tools, and file paths
- **`src/utils/storage-limit.ts`**: Configurable storage limits and auto-cleanup
- **`src/utils/status-bar.ts`**: Real-time status bar with keyboard shortcuts
- **`src/utils/storage-guidance.ts`**: Storage usage tips

### Commands

- **`src/commands/chat-session.ts`**: Interactive REPL with /commands (/help, /memory, /model, /permissions, /profile, /storage, /reload, /clear, /info)
- **`src/commands/profile.ts`**: Profile management (list, add, use, remove)
- **`src/commands/init-command.ts`**: Project initialization with AGENTS.md

### Entry Point

- **`src/cli.ts`**: Main CLI with Commander.js

## Coding Guidelines

1. **TypeScript strict mode**: All code uses strict TypeScript
2. **Error handling**: Always catch and provide meaningful error messages
3. **Security**: All file operations go through `resolveSafePath` validation
4. **Streaming**: Provider supports streaming responses for better UX
5. **Cross-platform**: Use Node's `node:*` imports for built-ins

## Key Patterns

### Tool Execution Flow (Parallel)

1. User sends message
2. Agent injects system prompt + shell env + persistent memory + project context
3. Agent calls provider with 10+ tools schema
4. Provider returns response (may include multiple tool calls)
5. **All independent tool calls execute in parallel** via `Promise.all`
6. Each tool passes through permission system
7. Tool results added to message history
8. Loop continues until no more tool calls

### Memory System

- Memories persist across sessions in `~/.sc-agent/memory/memory.json`
- Agent auto-loads last 10 memories into system prompt
- Model can call `memory_read`/`memory_write` to manage context
- User commands: `/memory`, `/memory show <key>`, `/memory forget <key>`, `/memory clear`
- Default tags for categorization

### Shell Environment Auto-Detection

- Detects: cmd, PowerShell, Git Bash, WSL, native Linux
- Injects platform-specific tips into system prompt
- Adapts tool usage guidance dynamically

### Configuration Hierarchy

1. Built-in defaults
2. Global config (`~/.sc-agent/config.json`)
3. Project config (`.sc-agent.json`)
4. Active profile overrides
5. Environment variables (SC_API_KEY, SC_MODEL, SC_PROFILE)

### Permission System

- Read-only tools (read_file, list_dir, search_text, web_fetch, memory_read) auto-approved
- Mutating tools (write_file, edit_file, run_shell, git, memory_write) require permission
- Blacklist profile: only dangerous commands ask (rm, sudo, del, etc.)
- Session tracking: "Ask once" mode remembers per session
- User can override with `-y` flag (auto-approve all)

### Error Recovery & Classification

- Errors classified into: compatibility, blocking, expectable
- Loop detection: detects repeated errors to prevent infinite loops
- Auto-retry with alternative approaches suggested
- Three failed attempts → alert user

## Competitive Advantages

| Feature | sc-agent-cli | Claude Code | Copilot CLI | Aider |
|---------|-------------|-------------|-------------|-------|
| Provider agnostic | ✅ (any API) | ❌ (Anthropic) | ❌ (OpenAI) | ✅ (any) |
| Web fetch tool | ✅ (native) | ❌ | ❌ | ❌ |
| Git tool | ✅ (native) | ✅ | ❌ | ❌ |
| Persistent memory | ✅ (cross-session) | ❌ | ❌ | ❌ |
| Parallel tool exec | ✅ (Promise.all) | ❌ | ❌ | ❌ |
| Smart permissions | ✅ (3 profiles) | ❌ (binary) | ❌ | ❌ |
| Cross-platform | ✅ (Win/Mac/Linux/WSL) | ❌ (Mac/Linux) | ❌ (Mac/Linux) | ✅ |
| Local models | ✅ (Ollama first) | ❌ | ❌ | ✅ |
| Shell env detection | ✅ (auto) | ❌ | ❌ | ❌ |
| Storage management | ✅ (limits/cleanup) | ❌ | ❌ | ❌ |
| Error classification | ✅ (3 categories) | ❌ | ❌ | ❌ |

## Build and Test

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript
npm run dev       # Watch mode
npm link          # Install globally
sc-agent          # Run the CLI
```

## Common Tasks

### Adding a New Tool

1. Create `src/tools/my-tool.ts` implementing the `Tool` interface
2. Add to `src/tools/registry.ts` in `ALL_TOOLS` array
3. Auto-approve in `src/core/config.ts` if read-only
4. Rebuild: `npm run build`

### Adding a New Command

1. Create `src/commands/my-command.ts`
2. Import and register in `src/cli.ts`
3. Add to autocomplete in `src/utils/autocomplete.ts`
4. Update /help in `src/commands/chat-session.ts`
5. Rebuild: `npm run build`

### Testing with Different Providers

```bash
# Ollama (local - default)
sc-agent profile use ollama

# OpenAI
sc-agent profile use openai

# Custom
sc-agent profile add my-custom
sc-agent profile use my-custom
```

## Dependencies

- **chalk**: Terminal colors
- **commander**: CLI framework
- **diff**: Unified diff patching
- **fast-glob**: Fast file globbing
- **ignore**: .gitignore-style pattern matching
- **prompts**: Interactive prompts

## Notes

- Uses native `fetch` (Node 18+), no external HTTP library needed
- Streaming is done via `ReadableStream` (Web Streams API)
- Cross-platform shell execution uses `spawn({ shell: true })`
- No external AI SDK dependencies (direct API calls)
