# Documentation Index

Index of every document in `docs/`. Use this as the canonical anchor when
adding cross-references: a link target that appears here is guaranteed to
exist, so the doc link sweep (`grep`/`rg` over `docs/` + root `*.md`) can be
verified mechanically.

> When you add, rename, or remove a doc in `docs/`, update this index in the
> same change so links stay resolvable.

## Getting Started & Reference

| Document | Description |
|----------|-------------|
| [../README.md](../README.md) | Project overview, features, installation, usage |
| [../QUICKSTART.md](../QUICKSTART.md) | Five-minute start guide |
| [../INSTALL.md](../INSTALL.md) | Detailed installation instructions |
| [../EXAMPLES.md](../EXAMPLES.md) | Usage examples |
| [available-models.md](available-models.md) | Supported models and providers |
| [environment-variables.md](environment-variables.md) | `SC_*` environment variables |
| [exit-codes.md](exit-codes.md) | Exit-code contract for headless runs |
| [FAQ.md](FAQ.md) | Frequently asked questions and troubleshooting |
| [../PROJECT-SUMMARY.md](../PROJECT-SUMMARY.md) | High-level project summary |

## Permissions & Security

| Document | Description |
|----------|-------------|
| [permission-profiles.md](permission-profiles.md) | Permission profiles (Traditional / Blacklist) and safety analysis |
| [permissions-command.md](permissions-command.md) | `/permissions` command reference |
| [pre-approved-commands.md](pre-approved-commands.md) | `/pre-approved-commands` interview flow |
| [sandboxing.md](sandboxing.md) | Tool-call sandboxing (`sandbox` config, bwrap + egress proxy) |
| [SECURITY-CRITICAL-FIXES.md](SECURITY-CRITICAL-FIXES.md) | Security-critical fixes and hardening notes |
| [../SECURITY.md](../SECURITY.md) | Security policy and reporting |

## Error Handling & Reliability

| Document | Description |
|----------|-------------|
| [loop-detection.md](loop-detection.md) | Repeated-error loop detection and error classification |
| [task-status-intelligence.md](task-status-intelligence.md) | Blocking vs. expectable error classification |
| [github-merge-workflow.md](github-merge-workflow.md) | PR merge workflow and status-check verification |

## Sessions, Tools & UX

| Document | Description |
|----------|-------------|
| [non-interactive-mode.md](non-interactive-mode.md) | Non-interactive (`sc <prompt>`) mode |
| [autocomplete.md](autocomplete.md) | Tab completion for commands, tools, and paths |
| [keyboard-shortcuts.md](keyboard-shortcuts.md) | Interactive keyboard shortcuts |
| [reload-command.md](reload-command.md) | `/reload` command guide |
| [memory.md](memory.md) | Persistent cross-session memory and scoped tiers |
| [mcp-servers.md](mcp-servers.md) | MCP server integration |
| [plugin-tools.md](plugin-tools.md) | External tool plugins |
| [ux-improvements.md](ux-improvements.md) | UX improvements |
| [visual-improvements.md](visual-improvements.md) | Visual improvements |

## Platform & Setup

| Document | Description |
|----------|-------------|
| [anthropic-setup.md](anthropic-setup.md) | Using Anthropic models via a proxy |
| [nvidia-nemotron-setup.md](nvidia-nemotron-setup.md) | Using NVIDIA Nemotron with SC CLI |
| [wsl-integration.md](wsl-integration.md) | WSL integration and dual GitHub accounts |
| [wsl-pipes-fix.md](wsl-pipes-fix.md) | WSL pipe-syntax fix |
| [windows-sc-conflict.md](windows-sc-conflict.md) | Windows `sc` command name conflict |
