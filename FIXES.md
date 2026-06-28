# Fixes Applied

## 2026-06-28: Fixed `list_dir` Tool Validation Error

### Problem
The CLI was failing with repeated "path must not be empty" errors when the LLM tried to use the `list_dir` tool. This created an infinite loop where the agent would retry the same operation multiple times.

### Root Cause
The JSON Schema for the `list_dir` tool had `minLength: 1` validation on the `path` parameter. When the LLM sent an empty string for `path`, the validation failed **before** the tool's `execute` function could run. The tool's code already had proper handling for empty paths (defaulting to "."), but it never got executed due to the schema validation.

### Solution
1. **Removed `minLength: 1` from JSON Schema** - Let the tool's code handle empty/invalid paths
2. **Removed `default: '.'`** - Not needed since the code handles this
3. **Improved description** - Clarified that empty paths default to current directory
4. **Strengthened system prompt** - Made it explicit that empty strings cause validation errors

### Files Changed
- `src/tools/list-dir.ts` - Relaxed JSON Schema validation
- `src/core/agent.ts` - Improved system prompt guidance

### Testing
After this fix, the LLM should:
- Always send `path: "."` for current directory
- Never send empty strings (but if it does, the tool handles it gracefully)
- Avoid validation errors and infinite loops

### Related Issues
This fix prevents the error loop shown in the original issue where the agent tried `list_dir` 3 times and failed each time with the same validation error.
