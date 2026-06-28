# Reload Command Guide

The `reload` command provides a seamless way to refresh your shell environment and SC CLI configuration without closing your terminal.

## Why You Need Reload

When you modify shell configuration files (PowerShell `$PROFILE` or bash `~/.bashrc`), changes don't take effect automatically. You normally need to:

- **PowerShell**: Run `. $PROFILE` or open a new terminal
- **WSL/Bash**: Run `source ~/.bashrc` or open a new terminal

The `reload` command simplifies this to a single word.

## Three Reload Commands

### 1. Shell Reload (PowerShell)

Reloads your PowerShell profile.

```powershell
reload
```

**What it does:**
- Executes `. $PROFILE`
- Reloads all functions, aliases, and environment variables
- Applies changes without closing the terminal

**When to use:**
- After modifying `$PROFILE`
- After changing environment variables
- After installing new PowerShell modules

**Example:**

```powershell
# Edit profile to add new alias
notepad $PROFILE

# Save changes and reload
reload

# New aliases/functions now available
```

---

### 2. Shell Reload (WSL/Bash)

Reloads your bash profile.

```bash
reload
```

**What it does:**
- Executes `source ~/.bashrc`
- Reloads all aliases, functions, and exports
- Applies changes without closing the terminal

**When to use:**
- After modifying `~/.bashrc`
- After changing `export` variables
- After adding new aliases

**Example:**

```bash
# Edit bashrc to add new export
nano ~/.bashrc

# Save changes and reload
reload

# New environment variables now available
```

---

### 3. In-Chat Config Reload

Reloads SC CLI configuration during a chat session.

```
You: /reload
```

**What it does:**
- Reloads `~/.sc-agent/config.json` from disk
- Applies changes to active profile
- Updates model settings
- Preserves conversation history (use `/clear` to reset)

**When to use:**
- After changing active profile with `scc profile use <name>`
- After editing config file manually
- After adding new model profiles
- When config feels stale

**Example:**

```
You: /reload

♻️  Reloading configuration...

✓ Configuration reloaded successfully!
  Active profile: llama-3.3-70b
  Model: meta/llama-3.3-70b-instruct

💡 Tip: Conversation history preserved. Use /clear to reset.
```

---

## Common Workflows

### Workflow 1: Change Model Profile

**Without reload** (old way):

```powershell
scc profile use llama-3.3-70b
exit  # Close current chat
scc   # Restart with new profile
```

**With reload** (new way):

```powershell
# In another terminal
scc profile use llama-3.3-70b

# In chat session
You: /reload
✓ Configuration reloaded successfully!
  Active profile: llama-3.3-70b
```

---

### Workflow 2: Update Environment Variable

**Without reload:**

```powershell
$env:NVIDIA_API_KEY = "new-key"
# Need to restart terminal for scc to pick it up
```

**With reload:**

```powershell
# Option A: PowerShell session
$env:NVIDIA_API_KEY = "new-key"
reload  # Reloads profile

# Option B: In chat
You: /reload  # Picks up new env var
```

---

### Workflow 3: Edit Config File

**Without reload:**

```bash
nano ~/.sc-agent/config.json
# Edit some settings
scc  # Start new session to see changes
```

**With reload:**

```bash
nano ~/.sc-agent/config.json
# Edit some settings

# If already in chat:
You: /reload
✓ Configuration reloaded successfully!
```

---

## Comparison

| Scenario | Without Reload | With Reload |
|----------|----------------|-------------|
| Change PowerShell profile | Open new terminal | `reload` |
| Change bash profile | Open new terminal | `reload` |
| Switch SC CLI profile | Exit + restart chat | `/reload` in chat |
| Update env var | Restart terminal | `reload` |
| Edit config file | Restart SC CLI | `/reload` in chat |

---

## Tips

### PowerShell

```powershell
# Add reload to your profile (already done by setup script)
function reload {
    Write-Host "♻️  Reloading PowerShell profile..." -ForegroundColor Cyan
    . $PROFILE
    Write-Host "✓ Profile reloaded successfully!" -ForegroundColor Green
}
```

### WSL/Bash

```bash
# Add reload to ~/.bashrc (already done by setup script)
reload() {
    echo "♻️  Reloading bash profile..."
    source ~/.bashrc
    echo "✓ Profile reloaded successfully!"
}
```

### In Chat

The `/reload` command is always available - no setup needed:

```
You: /help
📖 Available Commands:

  /help        - Show this help message
  /model       - Switch to a different model
  /reload      - Reload configuration from disk  ← HERE
  /clear       - Clear conversation history
  /info        - Show current model and config
  exit, quit   - End the chat session
```

---

## Troubleshooting

### reload: command not found (PowerShell)

Your profile wasn't reloaded yet. Run:

```powershell
. $PROFILE
```

Then `reload` will be available.

### reload: command not found (Bash)

Run the setup script or manually add to `~/.bashrc`:

```bash
reload() {
    echo "♻️  Reloading bash profile..."
    source ~/.bashrc
    echo "✓ Profile reloaded successfully!"
}
```

Then:

```bash
source ~/.bashrc
```

### /reload doesn't pick up changes

Make sure you saved the config file. Check:

```bash
cat ~/.sc-agent/config.json
```

If changes are there, `/reload` should pick them up.

### Environment variable not updating

Environment variables set in the current shell session take precedence:

```powershell
# This overrides $PROFILE for this session only
$env:NVIDIA_API_KEY = "temporary-key"

# reload won't change it because it's session-level

# To reset, close terminal or unset:
Remove-Item Env:\NVIDIA_API_KEY
reload  # Now picks up from $PROFILE
```

---

## Benefits

✅ **No more terminal restarts** - Save time  
✅ **Seamless config updates** - Apply changes instantly  
✅ **Better UX** - One word instead of complex commands  
✅ **Conversation preserved** - `/reload` keeps chat history  
✅ **Cross-platform** - Works in PowerShell and WSL  

---

## See Also

- [SETUP.md](../SETUP.md) - Initial setup guide
- [README.md](../README.md) - Main documentation
- [docs/available-models.md](available-models.md) - Model switching guide
