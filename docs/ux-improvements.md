# UX Improvements

Based on real user feedback, we've made several improvements to make SC CLI more user-friendly and informative.

## Problem: Confusing Error Messages

### Before
```
✗ Tool failed: Path D:/git/workspace-os is outside workspace
```

**Issues:**
- ❌ Doesn't explain WHY it's blocked
- ❌ Doesn't show what the workspace actually is
- ❌ Doesn't suggest how to fix it

### After
```
✗ Tool failed: Access denied: "D:/git/workspace-os" is outside the workspace.
  Workspace root: D:\git\sc-agent-cli
  Requested path: D:\git\workspace-os

💡 Tip: I can only access files within the current workspace for security.
   To work with files in other directories, navigate there first:
   → Use "cd <directory>" to change workspace
```

**Improvements:**
- ✅ Shows both workspace root and requested path
- ✅ Explains the security reason
- ✅ Suggests actionable solution

---

## Problem: Repetitive Permission Prompts

### Before
```
🔐 Permission required for tool: run_shell
   Args: {"command": "ls -la"}
√ Allow this action? ... yes

🔐 Permission required for tool: run_shell
   Args: {"command": "dir"}
√ Allow this action? ... yes

🔐 Permission required for tool: run_shell
   Args: {"command": "dir D:\\git"}
√ Allow this action? ... yes
```

**Issues:**
- ❌ Asked 3 times for similar commands
- ❌ No hint on how to avoid repeated prompts
- ❌ User doesn't know about `-y` flag

### After
```
🔐 Permission required: run_shell
   Args: {"command": "ls -la"}

   💡 To auto-approve shell commands, use: scc chat -y

√ Allow this action? ... yes
```

**Improvements:**
- ✅ Shows helpful tip on first permission request
- ✅ User learns about `-y` flag
- ✅ Better UX for power users

---

## Problem: No Summary After Multiple Tools

### Before
```
🔧 Using tool: list_dir
   Args: {"path":"."}
✗ Tool failed: path must not be empty

🔧 Using tool: list_dir
   Args: {"path":"D:\\git\\workspace-os"}
✗ Tool failed: Path D:\git\workspace-os is outside workspace

🔧 Using tool: list_dir
   Args: {"path":"workspace-os"}
✗ Tool failed: ENOENT: no such file or directory

🔧 Using tool: run_shell
   Args: {"command":"ls -la"}
✗ Tool failed: Command exited with code 1

🔧 Using tool: run_shell
   Args: {"command":"dir"}
✓ Tool completed

🔧 Using tool: run_shell
   Args: {"command":"dir D:\\git"}
✓ Tool completed
```

**Issues:**
- ❌ No overview of what happened
- ❌ Hard to see what succeeded vs failed
- ❌ User has to manually count successes/failures

### After
```
🔧 Executing 6 tools...
   → list_dir: {"path":"."}
  ✗ list_dir failed: path must not be empty

   → list_dir: {"path":"D:\\git\\workspace-os"}
  ✗ list_dir failed: Access denied: "D:/git/workspace-os" is outside the workspace.
      (see helpful tip above)

   → list_dir: {"path":"workspace-os"}
  ✗ list_dir failed: ENOENT: no such file or directory

   → run_shell: {"command":"dir"}
   → run_shell: {"command":"dir D:\\git"}

✓ All 2 tools completed successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Summary: 4 error(s) encountered
   • list_dir: path must not be empty
   • list_dir: Access denied (outside workspace)
   • list_dir: ENOENT: no such file or directory
   • run_shell: Command exited with code 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Improvements:**
- ✅ Groups multiple tools with a header
- ✅ Compact output for better readability
- ✅ Clear summary at the end
- ✅ Easy to see what failed and why

---

## Problem: Technical Errors Without Help

### Before
```
✗ Tool failed: ENOENT: no such file or directory, scandir 'C:\Users\sergi\workspace-os'
```

**Issues:**
- ❌ Technical jargon (ENOENT)
- ❌ No suggestion for fixing
- ❌ Doesn't explain what went wrong

### After

Now errors are caught earlier with better messages:
- Path validation happens before tool execution
- Clear explanation of workspace boundaries
- Actionable suggestions included

---

## Comparison Table

| Issue | Before | After |
|-------|--------|-------|
| Error clarity | ❌ "Path is outside workspace" | ✅ Shows workspace root, requested path, and tip |
| Permission prompts | ❌ No hints | ✅ Shows tip about `-y` flag |
| Multiple tools | ❌ No grouping | ✅ Grouped header + summary |
| Failed tools | ❌ No summary | ✅ Clear summary with all errors |
| Technical errors | ❌ Raw error codes | ✅ User-friendly explanations |
| Actionable tips | ❌ None | ✅ Suggestions included |

---

## Implementation Details

### 1. Better Error Messages (`path-security.ts`)

```typescript
// Before
throw new Error(`Path ${inputPath} is outside workspace`);

// After
throw new Error(
  `Access denied: "${inputPath}" is outside the workspace.\n` +
  `  Workspace root: ${workspaceRoot}\n` +
  `  Requested path: ${resolved}\n\n` +
  `💡 Tip: I can only access files within the current workspace for security.\n` +
  `   To work with files in other directories, navigate there first:\n` +
  `   → Use "cd <directory>" to change workspace`
);
```

### 2. Tool Grouping (`agent.ts`)

```typescript
// Track tools used
const toolsUsed: Array<{name: string; success: boolean; error?: string}> = [];

// Group message for multiple tools
if (response.tool_calls.length > 1) {
  console.log(chalk.cyan(`🔧 Executing ${response.tool_calls.length} tools...`));
}

// Compact output
if (response.tool_calls.length === 1) {
  console.log(chalk.cyan(`🔧 Using tool: ${toolName}`));
  console.log(chalk.gray(`   Args: ${JSON.stringify(args)}`));
} else {
  console.log(chalk.gray(`   → ${toolName}: ${JSON.stringify(args)}`));
}
```

### 3. Summary at End

```typescript
// Final summary if tools were used
if (toolsUsed.length > 0) {
  const failedTools = toolsUsed.filter(t => !t.success);

  if (failedTools.length > 0) {
    console.log(chalk.yellow(`⚠️  Summary: ${failedTools.length} error(s) encountered`));
    failedTools.forEach(t => {
      console.log(chalk.red(`   • ${t.name}: ${t.error}`));
    });
  }
}
```

### 4. Permission Tips (`permissions.ts`)

```typescript
// Add helpful tips based on tool
if (ctx.toolName === 'run_shell') {
  console.log(chalk.gray(`\n   💡 To auto-approve shell commands, use: scc chat -y`));
} else if (ctx.toolName === 'write_file' || ctx.toolName === 'edit_file') {
  console.log(chalk.gray(`\n   💡 To auto-approve file writes, add "${ctx.toolName}" to autoApprove in config`));
}
```

---

## User Benefits

✅ **Clearer errors** - Understand what went wrong and why  
✅ **Actionable tips** - Know how to fix issues  
✅ **Better overview** - Summary shows what succeeded/failed  
✅ **Less repetition** - Grouped output for multiple tools  
✅ **Learn as you go** - Tips teach you about features  
✅ **Professional feel** - Polished, informative UX  

---

## Testing These Improvements

Try these scenarios to see the improvements:

### 1. Test Better Error Messages

```
You: list files in D:/git/workspace-os
```

You'll see:
- Clear explanation of workspace boundary
- Both paths shown
- Actionable tip

### 2. Test Permission Tips

```
You: run "dir" command
```

First time you'll see:
- Permission prompt with tip about `-y` flag

### 3. Test Tool Grouping

Ask for something that requires multiple tool calls:

```
You: what files are in the parent directory?
```

You'll see:
- Grouped tool execution
- Compact output
- Summary at the end

---

## Future Improvements

Potential areas for further enhancement:

- [ ] Suggest auto-approve for frequently used tools
- [ ] Learn from user's permission patterns
- [ ] Batch similar permission requests
- [ ] Show progress bar for long operations
- [ ] Colorize errors by severity
- [ ] Add "Don't ask again for this session" option

---

## Feedback

These improvements were based on real user feedback. If you have suggestions for further UX improvements, please open an issue on GitHub.
