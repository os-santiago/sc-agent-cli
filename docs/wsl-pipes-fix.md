# WSL Pipe Syntax Fix

**Issue ID:** Detected from real trace analysis (2026-06-28)  
**Status:** ✅ FIXED  
**Files Changed:** `src/core/agent.ts`

---

## 🐛 **Problem**

When using WSL commands with pipes (`|`) on Windows, the pipe executes in **Windows (CMD/PowerShell)**, NOT inside WSL. This causes commands like `head`, `tail`, `grep`, `find` to fail.

### **Real Errors from Trace:**

```bash
# Error 1: head command
wsl gh pr diff 149 --repo os-santiago/workspace-os 2>&1 | head -100
→ 'head' is not recognized as an internal or external command

# Error 2: find command  
wsl find /home -name "workspace-os" -type d 2>/dev/null | head -5
→ The system cannot find the path specified.

# Error 3: jq select (pipe)
wsl gh run view ... --jq '.jobs[] | select(.conclusion=="failure") | .name'
→ 'select' is not recognized as an internal or external command
```

---

## 🔍 **Root Cause**

In Windows, when you run:

```bash
wsl <command> | <pipe>
```

The execution flow is:

1. **Windows executes:** `wsl <command>` → sends output to Windows stdout
2. **Windows executes:** `| <pipe>` → tries to run `<pipe>` command in **Windows**

**Problem:** Windows doesn't have `head`, `tail`, `find`, etc. → Command fails.

---

## ✅ **Solution**

Wrap the **entire command + pipe** in `bash -c` so it runs **inside WSL**:

### **Before (WRONG):**

```bash
wsl gh pr diff 149 | head -100
wsl find /home -name "*.py" | grep test
wsl gh run view --json jobs --jq '.jobs[] | select(...)'
```

### **After (CORRECT):**

```bash
wsl bash -c "gh pr diff 149 | head -100"
wsl bash -c "find /home -name '*.py' | grep test"
wsl bash -c 'gh run view --json jobs --jq ".jobs[] | select(...)"'
```

---

## 🔧 **Implementation**

Added to `src/core/agent.ts` system prompt:

```markdown
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
```

---

## 📊 **Impact**

### **Commands Affected:**

| Command | Before | After |
|---------|--------|-------|
| `head` | ❌ Fails | ✅ Works with `bash -c` |
| `tail` | ❌ Fails | ✅ Works with `bash -c` |
| `grep` | ❌ Fails | ✅ Works with `bash -c` |
| `find` | ❌ Fails | ✅ Works with `bash -c` |
| `jq` pipes | ❌ Fails | ✅ Works with `bash -c` |

### **Before Fix:**

```
⚠️ 10 error(s) encountered
   • 'head' is not recognized
   • 'select' is not recognized
   • The system cannot find the path specified
```

### **After Fix:**

```
✓ All WSL commands with pipes work correctly
✓ Agent knows to use bash -c wrapper
✓ Clear error message guidance in system prompt
```

---

## 🧪 **Testing**

### **Test Case 1: head command**

```bash
# Before (fails)
wsl gh pr diff 149 | head -100

# After (works)
wsl bash -c "gh pr diff 149 | head -100"
```

### **Test Case 2: find with grep**

```bash
# Before (fails)
wsl find /home -name "*.py" | grep test

# After (works)  
wsl bash -c "find /home -name '*.py' | grep test"
```

### **Test Case 3: jq complex filter**

```bash
# Before (fails)
wsl gh run view --json jobs --jq '.jobs[] | select(.conclusion=="failure")'

# After (works)
wsl bash -c 'gh run view --json jobs --jq ".jobs[] | select(.conclusion==\"failure\")"'
```

---

## 📚 **Related Issues**

- Loop Detection false positives (these errors triggered loop warnings)
- Task Status classification (classified as "expected" instead of "compatibility")

---

## ✅ **Resolution**

**Status:** FIXED in commit `3ea02d6`

- ✅ System prompt updated with WSL pipe guidance
- ✅ Examples added for all affected commands
- ✅ Error messages documented for quick diagnosis
- ✅ Alternative approaches suggested (avoid pipes when possible)

---

## 📖 **See Also**

- [wsl-integration.md](wsl-integration.md) - Full WSL integration guide
- [loop-detection.md](loop-detection.md) - Loop detection improvements
- [task-status-intelligence.md](task-status-intelligence.md) - Error classification
