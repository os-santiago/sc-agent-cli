# SC-Agent CLI - Agent Instructions

## Project Overview

**SC-Agent CLI** is a provider-agnostic AI agent CLI tool that supports any OpenAI-compatible API. It provides a chat interface with tool use capabilities (file operations, shell execution, text search) and a flexible permission system.

## Key Architecture

### Core Components

- **`src/core/types.ts`**: TypeScript type definitions (messages, tools, config)
- **`src/core/config.ts`**: Configuration loading/saving with profile support
- **`src/core/provider.ts`**: OpenAI-compatible API client with streaming
- **`src/core/agent.ts`**: Main agent loop (ReAct-style with tool calling)
- **`src/core/project-context.ts`**: Loads project-specific context from `AGENTS.md`

### Tools System

- **`src/tools/tool.ts`**: Tool interface and context
- **`src/tools/registry.ts`**: Central registry of all available tools
- Individual tools in `src/tools/`:
  - `read-file.ts`: Read file contents
  - `write-file.ts`: Create/overwrite files
  - `edit-file.ts`: Apply unified diff patches
  - `list-dir.ts`: List directory contents
  - `search-text.ts`: Search text with glob patterns
  - `run-shell.ts`: Execute shell commands

### Utilities

- **`src/utils/permissions.ts`**: Permission request system
- **`src/utils/path-security.ts`**: Path validation and sandboxing

### Commands

- **`src/commands/chat-session.ts`**: Interactive REPL
- **`src/commands/profile.ts`**: Profile management (list, add, use, remove)
- **`src/commands/init-command.ts`**: Project initialization

### Entry Point

- **`src/cli.ts`**: Main CLI with Commander.js

## Coding Guidelines

1. **TypeScript strict mode**: All code uses strict TypeScript
2. **Error handling**: Always catch and provide meaningful error messages
3. **Security**: All file operations go through `resolveSafePath` validation
4. **Streaming**: Provider supports streaming responses for better UX
5. **Cross-platform**: Use Node's `node:*` imports for built-ins

## Key Patterns

### Tool Execution Flow

1. User sends message
2. Agent calls provider with tools schema
3. Provider returns response (may include tool calls)
4. Agent executes each tool via permission system
5. Tool results added to message history
6. Loop continues until no more tool calls

### Configuration Hierarchy

1. Built-in defaults
2. Global config (`~/.sc-agent/config.json`)
3. Project config (`.sc-agent.json`)
4. Active profile overrides

### Permission System

- Read-only tools (read_file, list_dir, search_text) auto-approved by default
- Mutating tools (write_file, edit_file, run_shell) require explicit permission
- User can override with `-y` flag (auto-approve all)

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
3. Rebuild: `npm run build`

### Adding a New Command

1. Create `src/commands/my-command.ts`
2. Import and register in `src/cli.ts`
3. Rebuild: `npm run build`

### Testing with Different Providers

```bash
# Ollama (local)
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
