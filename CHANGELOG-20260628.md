# Changelog - 2026-06-28

## Critical Fixes Applied Today

### 1. Fixed "path must not be empty" Error
**Commit:** f80dc38
**Problem:** `list_dir` tool failed when accessing workspace root due to `ignore` library rejecting empty strings.
**Solution:** Skip deny pattern check when relativePath is empty (workspace root itself).

### 2. Fixed Models Not Generating Response After Tool Calls
**Commit:** 83a411d / d39cce0
**Problem:** LLM executed tools successfully but showed no visible response to user.
**Solution:** 
- Changed tool result messages from `role: 'assistant'` to `role: 'tool'` (per OpenAI spec)
- Added continuation prompt (`'...'`) to force synthesis

### 3. Fixed Unhelpful Task Summary
**Commit:** 887e0af
**Problem:** Summary showed generic error examples instead of actual errors.
**Solution:** Display actual error messages (first 3, truncated to 70 chars).

## Impact

**Before:**
- Tool calls would fail silently with generic errors
- No visible output after tool execution
- User had no idea what was accomplished

**After:**
- Tool calls execute successfully
- Clear, visible responses synthesizing tool results
- Informative error summaries showing actual issues

## Files Changed

- `src/utils/path-security.ts` - Skip empty path in deny pattern check
- `src/core/types.ts` - Added `'tool'` to MessageRole
- `src/core/agent.ts` - Tool role fix + continuation prompt + better summary
- `src/tools/list-dir.ts` - Stricter JSON Schema (required + pattern)

## Testing

All fixes verified with NVIDIA Nemotron provider on real workspace analysis tasks.
