# Release Notes v0.3.1

**Release Date:** 2026-06-28  
**Version:** 0.3.1  
**Type:** Bug Fix + Feature Release

---

## 🎯 **What's New**

This release fixes critical Windows compatibility issues discovered through real-world trace analysis and adds a comprehensive PR review workflow.

---

## 🐛 **Bug Fixes**

### **1. WSL Pipe Syntax Errors** ✅

**Problem:** WSL commands with pipes failed on Windows:

```bash
wsl gh pr diff 149 | head -100
→ 'head' is not recognized as an internal or external command

wsl find /home -name "*.py" | grep test
→ The system cannot find the path specified
```

**Root Cause:** The pipe `|` executes in Windows (CMD/PowerShell), not inside WSL.

**Solution:** System prompt now guides to use `wsl bash -c "command | pipe"`:

```bash
# ✅ Correct syntax
wsl bash -c "gh pr diff 149 | head -100"
wsl bash -c "find /home -name '*.py' | grep test"
```

**Affected Commands:** `head`, `tail`, `grep`, `find`, complex `jq` filters

**Documentation:** See `docs/wsl-pipes-fix.md` for complete details

---

### **2. Loop Detection False Positives** ✅

**Problem:** Loop detection incorrectly triggered on exploratory operations:

```
⚠ Detected repeated errors (possible infinite loop)
   • 5x: command exited with code 1...
   • 5x: command exited with code 255...
```

But the task was successful (approved 4 PRs, merged 3 PRs).

**Root Cause:** Loop detection counted **error messages** instead of **commands**.

**Solution:**
- Now normalizes commands (tool + base command)
- Excludes: 404, "not found", "not recognized", path errors
- Only triggers when SAME command fails ≥3 times consecutively

**Before:**
- Different exploratory operations → Loop warning ❌

**After:**
- Different operations → No warning ✅
- Same command 3x → Loop warning ✅

---

### **3. Task Status Misclassification** ✅

**Problem:** All errors classified as "expected errors (not blockers)":

```
✓ Task completed with notes
   10 expected error(s) occurred (not blockers).
```

But 3 errors were compatibility issues that needed fixing.

**Solution:** New error classification:

```typescript
compatibilityErrors  // Windows compat issues (need fixing)
blockingErrors       // Permission denied, syntax errors
expectableErrors     // 404s, merge conflicts, GitHub restrictions
```

**New Task Status:**

```
⚠️ Task completed with warnings

   Successfully completed with 32 operations.
   3 compatibility error(s) need fixing.
   7 expected error(s) occurred (not blockers).

   Windows compatibility issues detected:
   • WSL pipe syntax: use `wsl bash -c "cmd | pipe"`
   • Missing command: head (not available on Windows)
```

**Impact:**
- Clear distinction between fixable issues vs expected errors
- Actionable guidance for each issue type
- User knows WHAT to fix vs WHAT is OK

---

## ✨ **New Features**

### **Comprehensive PR Review Workflow** 🎯

Added mandatory 5-step review process before merging PRs:

**STEP 1: Validate PR Status & Checks**
- Verifies: state, mergeable, statusCheckRollup, reviewDecision
- Stops if checks pending, failing, or changes requested

**STEP 2: Review Comments**
- Analyzes CodeRabbit, reviewer, and bot comments
- Classifies: BLOCKING 🔴, ACTIONABLE 🟡, NITPICKS 🟢
- Stops merge if blocking/actionable comments unresolved

**STEP 3: Review Code Changes**
- Validates: Does it solve the problem?
- Checks: Are there tests? Edge cases handled?
- Reviews PR description and linked issues

**STEP 4: Impact Analysis**
- Checks for breaking changes
- Analyzes affected files
- Verifies test coverage
- Assesses regression risk

**STEP 5: Final Decision & Summary**
- Presents complete review summary
- Waits for user confirmation
- Only then proceeds with merge

**Example Summary:**

```markdown
## PR Review Summary: #170

### ✅ Status Checks
- CI/CD: PASS
- Tests: PASS

### 📝 Comments
- Blocking: 0
- Actionable: 1

### 🎯 Code Review
- Solves problem: YES
- Test coverage: GOOD

### ⚠️ Impact
- Breaking: NO
- Risk: LOW

### 🚦 DECISION: ✅ READY
```

**Impact:**
- Prevents premature merges
- Ensures code quality
- Validates all requirements met
- User has full visibility before merge

---

## 📚 **Documentation**

### **New Documentation:**

1. **docs/wsl-pipes-fix.md** (187 lines)
   - Complete WSL pipe syntax guide
   - Problem explanation
   - Solution examples
   - Testing scenarios

2. **TRACE-ANALYSIS-IMPROVEMENTS.md** (381 lines)
   - Full trace analysis report
   - 4 critical issues identified
   - Before/after comparisons
   - Impact metrics

3. **docs/wsl-integration.md** (500+ lines)
   - WSL integration guide
   - Multiple GitHub accounts (Windows vs WSL)
   - File path conversions
   - Common issues troubleshooting

### **Updated Documentation:**

- System prompt enhanced with WSL pipe guidance
- CHANGELOG.md updated with v0.3.1 section
- Loop detection behavior documented

---

## 📊 **Impact Summary**

| Metric | Before | After |
|--------|--------|-------|
| **WSL pipe errors** | 3 failures | 0 failures |
| **Loop false positives** | Yes (10 errors) | No |
| **Error classification** | All "expected" | 3 compat + 7 expected |
| **PR review steps** | None | 5 mandatory steps |
| **Merge safety** | No validation | Full review required |
| **Actionable guidance** | None | Specific per issue |

---

## 🔄 **Migration Guide**

### **No Breaking Changes**

This release has **no breaking changes**. All fixes are backwards compatible.

### **What You Should Know:**

1. **WSL Commands with Pipes:**
   - If using WSL, wrap piped commands in `bash -c`
   - System prompt now guides this automatically

2. **Task Status Messages:**
   - May see new warning format: "Task completed with warnings"
   - Provides more specific guidance than before

3. **PR Review Workflow:**
   - Agent now performs comprehensive review before merge
   - Presents summary and waits for confirmation
   - More thorough but safer merges

---

## 🆙 **Upgrade Instructions**

### **From v0.3.0:**

```bash
cd sc-agent-cli
git pull
npm install
npm run build
```

### **From source:**

```bash
git clone https://github.com/your-org/sc-agent-cli
cd sc-agent-cli
git checkout v0.3.1
npm install
npm run build
```

### **From npm:**

```bash
npm update sc-agent-cli
```

---

## 🧪 **Testing**

All fixes validated against real trace data:

✅ **WSL Pipe Syntax:**
- Tested: `head`, `tail`, `grep`, `find`, `jq` with pipes
- Result: All work correctly with `bash -c` wrapper

✅ **Loop Detection:**
- Tested: 10 different operations (compatibility + expected errors)
- Result: No false positive loop warning

✅ **Task Status:**
- Tested: 3 compatibility + 7 expected errors
- Result: Correct classification and guidance

✅ **PR Review Workflow:**
- Tested: Multiple PR scenarios (approved, blocked, conflicts)
- Result: Comprehensive review before merge

---

## 📦 **Installation**

### **NPM:**

```bash
npm install sc-agent-cli@0.3.1
```

### **From Source:**

```bash
git clone https://github.com/your-org/sc-agent-cli
cd sc-agent-cli
git checkout v0.3.1
npm install
npm run build
```

---

## 🐛 **Known Issues**

None at this time.

---

## 🙏 **Acknowledgments**

- **Sergio Canales** (@scanalesespinoza) - Project Lead
- **Claude Sonnet 4.5** - AI Pair Programmer
- **Community** - Real-world trace analysis feedback

---

## 📖 **See Also**

- [CHANGELOG.md](CHANGELOG.md) - Full changelog
- [TRACE-ANALYSIS-IMPROVEMENTS.md](TRACE-ANALYSIS-IMPROVEMENTS.md) - Trace analysis
- [docs/wsl-pipes-fix.md](docs/wsl-pipes-fix.md) - WSL pipe syntax
- [docs/wsl-integration.md](docs/wsl-integration.md) - WSL integration guide
- [SECURITY-CRITICAL-FIXES.md](docs/SECURITY-CRITICAL-FIXES.md) - v0.3.0 security fixes

---

## ⚖️ **License**

MIT License - See [LICENSE](LICENSE) file for details

---

**Enjoy v0.3.1!** 🚀
