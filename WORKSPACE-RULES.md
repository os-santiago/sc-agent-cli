# Workspace Rules for SC Agent CLI

## 🚨 CRITICAL: Repository Location Rules

### Official Repository
- **Path:** `D:\git\sc-agent-cli`
- **This is the ONLY directory to work in**
- **NEVER create copies or new directories**

### ❌ FORBIDDEN Operations

```bash
# DO NOT create new directories
mkdir ../sc-agent-cli-*
cp -r . ../sc-agent-cli-*
git clone . ../sc-agent-cli-*

# DO NOT work outside the official repo
cd /d/git/sc-agent-cli-something
cd ../sc-agent-cli-copy
```

### ✅ CORRECT Operations

```bash
# Stay in the official repository
cd D:\git\sc-agent-cli

# Create a new feature branch
git checkout -b fix/feature-name

# Make your changes HERE (in current directory)
# ... edit files ...

# Commit
git add .
git commit -m "fix: description"

# Switch back to main for next task
git checkout main

# For next feature, create another branch
git checkout -b fix/another-feature
```

## Workflow for Multiple Improvements

When working on multiple improvements:

1. **Start from main:**
   ```bash
   git checkout main
   ```

2. **For EACH improvement, create a NEW BRANCH in the SAME repo:**
   ```bash
   git checkout -b fix/improvement-1
   # make changes
   git add . && git commit -m "fix: improvement 1"

   git checkout main
   git checkout -b fix/improvement-2
   # make changes
   git add . && git commit -m "fix: improvement 2"

   git checkout main
   # repeat...
   ```

3. **NEVER leave the repository directory**

## Why This Matters

Previously, 34+ duplicate directories were created:
- `sc-agent-cli-async-command-parse/`
- `sc-agent-cli-profile-empty/`
- `sc-agent-cli-config-init-next-steps/`
- etc.

This was WRONG. All these should have been branches in the main repo:
- `fix/async-command-parse`
- `fix/profile-empty`
- `fix/config-init-next-steps`

## Summary

**ONE repository.** `D:\git\sc-agent-cli`  
**MANY branches.** `fix/feature-1`, `fix/feature-2`, etc.  
**ZERO new directories.**
