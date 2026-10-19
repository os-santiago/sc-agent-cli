# Documentation Index

Canonical documentation for SC-Agent CLI. Root-level entry points
(`README.md`, `QUICKSTART.md`, `INSTALL.md`) link here; release notes live in
[`CHANGELOG.md`](../CHANGELOG.md) (single source), and dated session
reports/audits are archived under [`history/`](history/).

## Getting started

- [SETUP.md](SETUP.md) — quick setup guide (PowerShell/WSL)
- [TEST-SETUP.md](TEST-SETUP.md) — manual environment-verification checklist
- [EXAMPLES.md](EXAMPLES.md) — usage examples
- [FAQ.md](FAQ.md) — common questions and troubleshooting
- [windows-sc-conflict.md](windows-sc-conflict.md) — resolving the Windows `sc` alias conflict
- [wsl-integration.md](wsl-integration.md) — WSL integration guide
- [wsl-pipes-fix.md](wsl-pipes-fix.md) — WSL pipe syntax issue and fix
- [nvidia-nemotron-setup.md](nvidia-nemotron-setup.md) — NVIDIA Nemotron profile setup
- [anthropic-setup.md](anthropic-setup.md) — Claude models via proxy

## Architecture & internals

- [ARCHITECTURE.md](ARCHITECTURE.md) — technical deep dive (diagrams, data flow, design decisions)
- [WORKSPACE-RULES.md](WORKSPACE-RULES.md) — repository/workspace rules for development
- [github-merge-workflow.md](github-merge-workflow.md) — GitHub PR merge workflow
- [SECURITY-CRITICAL-FIXES.md](SECURITY-CRITICAL-FIXES.md) — v0.3.0 security fixes detail
- [task-status-intelligence.md](task-status-intelligence.md) — error classification
- [loop-detection.md](loop-detection.md) — loop detection system
- [ux-improvements.md](ux-improvements.md) — UX improvements
- [visual-improvements.md](visual-improvements.md) — visual/UI improvements

## Usage & configuration reference

- [available-models.md](available-models.md) — provider/model comparison
- [environment-variables.md](environment-variables.md) — `SC_*` environment variables (guarded by `env-docs` test)
- [memory.md](memory.md) — persistent cross-session memory
- [permission-profiles.md](permission-profiles.md) — permission profiles and `denyCommands`/`denyPaths`
- [pre-approved-commands.md](pre-approved-commands.md) — pre-approved command scenarios
- [permissions-command.md](permissions-command.md) — `/permissions` command
- [autocomplete.md](autocomplete.md) — tab completion
- [keyboard-shortcuts.md](keyboard-shortcuts.md) — keyboard shortcuts
- [reload-command.md](reload-command.md) — `/reload` command
- [sandboxing.md](sandboxing.md) — `run_shell` sandbox (bwrap/proxy/seccomp)

## Automation & headless runs

- [non-interactive-mode.md](non-interactive-mode.md) — batch-mode flags and run manifest
- [exit-codes.md](exit-codes.md) — canonical exit-code contract
- [mcp-servers.md](mcp-servers.md) — MCP server integration (`mcp.servers`)
- [plugin-tools.md](plugin-tools.md) — external tool plugins (`plugins`)

## Archive

- [`history/`](history/) — dated session reports, audits, and verification
  write-ups preserved for reference (`TEST-RESULTS`, `VERIFICATION`,
  `CRITICAL-FIXES`, `TRACE-ANALYSIS-IMPROVEMENTS`, `PROJECT-SUMMARY`,
  `CLAUDE-CODE-PARITY`). These are point-in-time records, not canonical docs.
