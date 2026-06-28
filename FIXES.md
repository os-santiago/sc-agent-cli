# Fixes Applied

## 2026-06-28: Fixed `list_dir` Tool "path must not be empty" Error

### Problem
The CLI was failing with repeated "path must not be empty" errors when using the `list_dir` tool with path `"."`. This created an infinite loop where the agent would retry the same operation multiple times, always failing.

### Root Cause Investigation
Initially suspected JSON Schema validation, but debugging revealed:
1. The tool's `execute()` function WAS being called with correct args `{"path":"."}`
2. The error came from INSIDE `execute()`, specifically from the `ignore` library
3. When checking deny patterns on the workspace root:
   - `path.relative(workspaceRoot, workspaceRoot) = ""` (empty string)
   - `ig.ignores("")` throws "path must not be empty"
   - The `ignore` library validates and rejects empty path strings

### Actual Root Cause
The `ignore` library (used for deny pattern checking in `path-security.ts`) throws `"path must not be empty"` when called with an empty string. When listing the workspace root directory (path `"."`), the relative path between workspace root and resolved path is an empty string, triggering this error.

### Solution
1. **Skip deny pattern check for empty relativePath** in `path-security.ts`
   - Added check: `if (relativePath && ig.ignores(relativePath))`
   - Workspace root itself is never denied
2. **Made `path` parameter required** in JSON Schema
   - Forces LLM to always provide a path value
3. **Added pattern validation** `^.+$` to enforce non-empty strings
4. **Improved parameter description** to clarify "." must be used explicitly

### Files Changed
- `src/utils/path-security.ts` - Skip empty path when checking deny patterns
- `src/tools/list-dir.ts` - Stricter JSON Schema (required + pattern)
- `src/core/agent.ts` - Improved system prompt guidance (previous fix)

### Testing
After this fix:
- ✅ `list_dir` with path `"."` works correctly
- ✅ `list_dir` with path `""` defaults to `"."`  and works
- ✅ `list_dir` with no path parameter defaults to `"."` and works
- ✅ Full CLI test passes without errors
- ✅ No more infinite retry loops

### Related Issues
This fix completely resolves the error loop where the agent tried `list_dir` multiple times and failed each time with "path must not be empty".
