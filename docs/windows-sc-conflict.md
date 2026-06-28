# Windows SC Command Conflict

On Windows systems, there's a built-in command called `sc` (Service Control) that manages Windows services. This conflicts with our `sc` CLI command.

## The Problem

When you run `sc` on Windows, it may invoke the Windows Service Control command instead of our SC CLI:

```bash
$ sc --version
# Shows Windows SC help instead of SC CLI version
```

## Solutions

### Option 1: Use the Direct Path (Simplest)

Run the command directly via Node:

```bash
# From the project directory
node bin/sc.js

# Or with full path
node C:\Users\sergi\AppData\Roaming\npm\node_modules\sc-agent-cli\bin\sc.js
```

### Option 2: Create an Alias (Recommended)

Add an alias to your shell configuration:

**For Git Bash / WSL:**

```bash
# Add to ~/.bashrc or ~/.bash_profile
alias scc='node ~/path/to/sc-agent-cli/bin/sc.js'

# Or if installed globally via npm link
alias scc='node $(npm root -g)/sc-agent-cli/bin/sc.js'

# Reload
source ~/.bashrc

# Use
scc --help
```

**For PowerShell:**

```powershell
# Add to $PROFILE
function scc { node "C:\path\to\sc-agent-cli\bin\sc.js" $args }

# Reload
. $PROFILE

# Use
scc --help
```

### Option 3: Use npx (No Installation Required)

```bash
# From the project directory
npx . chat

# Or with full path
npx /d/git/sc-agent-cli chat
```

### Option 4: Rename the Command

If the conflict is too problematic, you can rename the command in `package.json`:

```json
{
  "bin": {
    "scc": "bin/sc.js"  // Change "sc" to "scc" or another name
  }
}
```

Then rebuild and relink:

```bash
npm run build
npm link
scc --help  # Now works without conflict
```

## Recommended Setup for Windows

1. **Use an alias**: Add `alias scc='node bin/sc.js'` to your shell config
2. **Use scc instead of sc**: `scc profile use nvidia`, `scc chat`, etc.
3. **Document the alias**: Keep the alias name consistent in your workflow

## Why Not Just Rename It?

The command `sc` is:

- Short and memorable
- Works fine on Linux/macOS
- The Windows conflict affects only the global command, not `node bin/sc.js`

We keep `sc` as the canonical name, but provide workarounds for Windows users.

## Testing the Alias

```bash
# Create alias
alias scc='node bin/sc.js'

# Test
scc --version        # Should show: 0.1.0
scc profile list     # Should list profiles
scc --help           # Should show SC CLI help

# If it still shows Windows SC help, check:
which scc            # Should show: scc: aliased to node bin/sc.js
```

## Alternative: Use Full Command Name

If you prefer a more explicit command without aliases:

```bash
# Just use the direct invocation
node bin/sc.js profile use nvidia
node bin/sc.js chat
```

This is verbose but unambiguous and requires no configuration.
