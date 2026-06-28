# Fixes Applied

## 2026-06-28: Fixed Missing Responses After Tool Calls

### Problem
After executing tool calls successfully, the LLM would not generate any visible response to the user. The CLI would show "Task completed successfully" but with no actual answer or analysis from the assistant. This created a very poor user experience where users couldn't tell what the agent discovered or accomplished.

### Symptoms
```
┌─ Tools ─────────────────────────────────────────────────┐
│ 🔧 Using tool: list_dir
│    Args: {"path":"."}
│ ✓ Tool completed
└─────────────────────────────────────────────────────────┘

  [NO RESPONSE HERE - JUST SILENCE]

┌─ Task Status ───────────────────────────────────────────┐
│ ✓ Task completed successfully
└─────────────────────────────────────────────────────────┘
```

### Root Causes
1. **Incorrect Message Role**: Tool results were being sent with `role: 'assistant'` instead of `role: 'tool'`
   - OpenAI API specification requires tool results to use `role: 'tool'`
   - Some providers (NVIDIA, strict OpenAI implementations) enforce this and won't generate responses when violated

2. **Missing Continuation Signal**: Some models (NVIDIA Nemotron, older LLaMA variants) don't automatically generate a synthesis response after receiving tool results
   - They need an explicit signal to continue the conversation
   - Without it, they terminate immediately after tool execution

### Solution
1. **Corrected Message Role** (`src/core/types.ts` + `src/core/agent.ts`)
   ```typescript
   // Before: role: 'assistant'
   // After:  role: 'tool'
   messages.push({
     role: 'tool',  // ← Correct per OpenAI spec
     content: result,
     tool_call_id: toolCall.id,
     name: toolName,
   });
   ```

2. **Added Continuation Prompt** (`src/core/agent.ts`)
   ```typescript
   // After all tool results, add minimal continuation signal
   messages.push({
     role: 'user',
     content: '...',  // Minimal token to trigger synthesis
   });
   ```

### Technical Details
According to [OpenAI Function Calling docs](https://platform.openai.com/docs/guides/function-calling):
- When the model calls a function, it returns `role: "assistant"` with `tool_calls`
- When you provide function results, use `role: "tool"` with `tool_call_id`
- The model then generates a final response synthesizing the results

However, some providers don't auto-generate that final response. The continuation prompt (`"..."`) is a workaround that signals "please continue with your answer".

### Files Changed
- `src/core/types.ts` - Added `'tool'` to `MessageRole` type
- `src/core/agent.ts` - Changed tool results to `role: 'tool'` and added continuation prompt

### Testing
After this fix:
- ✅ Tool calls execute successfully
- ✅ Model generates visible response synthesizing results
- ✅ User sees coherent answer to their question
- ✅ Works with NVIDIA Nemotron, OpenAI, and other providers

### Impact
This was a **critical UX bug** - users had no way to see what the agent discovered or accomplished. Now the CLI provides clear, visible responses after every tool execution.

---

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
