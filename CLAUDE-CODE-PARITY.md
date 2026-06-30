# Claude Code Parity Analysis

Comparison between **Claude Code** (official Anthropic CLI) and **SCC** (sc-agent-cli) to identify gaps and create a roadmap to maturity.

---

## ✅ What SCC Already Has

### Core Functionality
- ✅ **OpenAI-compatible provider support** - Works with NVIDIA, Ollama, OpenAI, etc.
- ✅ **Tool use (function calling)** - list_dir, read_file, write_file, edit_file, run_shell, search_text
- ✅ **Streaming responses** - Real-time output
- ✅ **Project context loading** - Reads AGENTS.md for context
- ✅ **Permission system** - Auto-approve patterns, deny paths, profiles
- ✅ **Multi-profile support** - Switch between different LLM providers
- ✅ **Interactive chat mode** - Persistent sessions with history
- ✅ **Path security** - Workspace boundary enforcement, deny patterns
- ✅ **Error detection** - Loop detection, compatibility warnings, error classification

### UX Features
- ✅ **Colored output** - Chalk for better readability
- ✅ **Task status reporting** - Success/failure summaries
- ✅ **Tool execution visibility** - Shows args and results
- ✅ **Storage tracking** - Session size limits (1GB default)
- ✅ **Git integration hints** - Suggests gh CLI usage

---

## ❌ What SCC is Missing (Claude Code Has)

### 1. **Reliable Response Generation** ❌ CRITICAL

**Claude Code:**
- ALWAYS generates visible text after tool calls
- Never shows "Task completed successfully" without explanation
- Properly implements OpenAI tool message format

**SCC:**
- ❌ Inconsistent response generation (depends on model)
- ❌ Tool results use wrong message role (reverted 4x)
- ❌ Missing continuation prompt (reverted 4x)
- ❌ No validation that response was generated

**Impact:** Users frequently see tool executions with ZERO explanation.

**Fix Status:** Implemented but keeps getting reverted due to branch management.

---

### 2. **Robust State Management** ❌ HIGH

**Claude Code:**
- Conversation state persists correctly across turns
- Message history doesn't corrupt
- Tool results properly integrated into context

**SCC:**
- ❌ Message role violations break some providers
- ❌ No validation of message sequence correctness
- ❌ Tool results can break conversation flow

**Gap:** Need message sequence validator and state machine.

---

### 3. **Better Error Recovery** ❌ MEDIUM

**Claude Code:**
- Graceful degradation when tools fail
- Suggests alternatives when primary approach fails
- Never leaves user hanging

**SCC:**
- ✅ Has loop detection (3 failed attempts)
- ✅ Shows error summaries
- ❌ Doesn't suggest alternative approaches
- ❌ Generic fallback messages

**Gap:** Error recovery strategies and alternative suggestions.

---

### 4. **Multi-Agent Orchestration** ❌ LOW

**Claude Code:**
- Can spawn subagents for parallel work
- Workflow support for complex tasks
- Agent coordination primitives

**SCC:**
- ❌ No subagent support
- ❌ No workflow orchestration
- ❌ Single-threaded execution only

**Gap:** Agent primitives, task decomposition, parallel execution.

---

### 5. **Better Tool Descriptions** ❌ MEDIUM

**Claude Code:**
- Tools have rich, context-aware descriptions
- Examples in tool documentation
- Best practices encoded in tool schemas

**SCC:**
- ✅ Basic tool descriptions
- ❌ No examples in schemas
- ❌ Minimal guidance on when to use each tool

**Gap:** Enhanced tool schemas with examples and usage patterns.

---

### 6. **Conversation Management** ❌ MEDIUM

**Claude Code:**
- Smart context pruning
- Keeps important messages, summarizes old context
- Never hits context limits abruptly

**SCC:**
- ❌ No context management
- ❌ Will fail when hitting model limits
- ❌ No summarization or pruning

**Gap:** Sliding window context manager with summarization.

---

### 7. **Better System Prompts** ❌ MEDIUM

**Claude Code:**
- Concise, effective prompts
- Model-specific optimizations
- Dynamic prompt assembly based on context

**SCC:**
- ✅ Has comprehensive system prompt
- ❌ TOO VERBOSE (900+ lines of GitHub workflow rules)
- ❌ No model-specific adjustments
- ❌ Fixed prompt regardless of task

**Gap:** Modular prompts, model-aware prompting.

---

### 8. **Testing & Validation** ❌ HIGH

**Claude Code:**
- Comprehensive test suite
- Integration tests
- CI/CD pipeline
- Quality gates

**SCC:**
- ✅ One validation test (response generation)
- ❌ No integration tests
- ❌ No CI/CD
- ❌ No automated quality checks

**Gap:** Full test coverage with CI/CD.

---

### 9. **Documentation** ❌ MEDIUM

**Claude Code:**
- Excellent README
- API documentation
- Troubleshooting guides
- Migration guides

**SCC:**
- ✅ Basic README
- ✅ ARCHITECTURE.md
- ✅ CRITICAL-FIXES.md (new)
- ❌ No API docs
- ❌ No troubleshooting guide
- ❌ No user guide

**Gap:** Comprehensive docs for users and contributors.

---

### 10. **Performance** ❌ LOW

**Claude Code:**
- Fast startup
- Efficient streaming
- Minimal overhead

**SCC:**
- ✅ Streaming works
- ❌ No performance benchmarks
- ❌ No optimization work done

**Gap:** Performance profiling and optimization.

---

## 🎯 Priority Roadmap to Parity

### P0 - Critical (Blocks Basic Usage)

**1. Fix Response Generation Permanently**
- Problem: Keeps getting reverted
- Solution: 
  - ✅ Add validation tests (DONE)
  - ✅ Add inline "DO NOT REMOVE" comments (DONE)
  - ❌ **MUST DO:** Merge all fixes to main and STOP switching branches
  - ❌ **MUST DO:** Add pre-commit hook that runs `npm run test:validation`
  
**2. Message Role Correctness**
- Problem: Tool results use `role:'assistant'` instead of `role:'tool'`
- Solution:
  - ✅ Code fix exists (DONE)
  - ❌ **MUST DO:** Never revert types.ts MessageRole type
  - ❌ **MUST DO:** Add ESLint rule to enforce `role:'tool'` for tool messages

**3. Path Security Fix**
- Problem: `path must not be empty` error from ignore library
- Solution:
  - ✅ Code fix exists (DONE)
  - ❌ **MUST DO:** Apply to main branch permanently

---

### P1 - High (Major UX Issues)

**4. Message Sequence Validator**
```typescript
function validateMessageSequence(messages: Message[]): void {
  // Ensure tool results have role:'tool'
  // Ensure tool results follow assistant tool_calls
  // Ensure no orphaned tool_call_ids
  // Throw descriptive errors on violations
}
```

**5. Better Error Recovery**
```typescript
interface ErrorRecoveryStrategy {
  detectError(error: string): boolean;
  suggestAlternative(context: Context): string;
}

const strategies: ErrorRecoveryStrategy[] = [
  windowsCommandFallback,  // ls → dir
  pathResolutionRetry,     // Try ./ prefix
  toolSelectionAlternative // list_dir failed → run_shell
];
```

**6. Modular System Prompts**
```typescript
const systemPrompt = [
  baseInstructions,
  platform === 'win32' ? windowsCommands : unixCommands,
  task.includes('github') ? githubGuidelines : null,
  model === 'nvidia' ? nvidiaQuirks : null,
].filter(Boolean).join('\n\n');
```

---

### P2 - Medium (Nice to Have)

**7. Context Management**
- Sliding window with summarization
- Keep first/last N messages
- Summarize middle messages
- Smart pruning (keep tool calls + results together)

**8. Enhanced Tool Schemas**
- Add examples to each tool
- Usage patterns and best practices
- When NOT to use (anti-patterns)

**9. Better Documentation**
- Troubleshooting guide
- Common errors and solutions
- Architecture deep-dive
- Contributing guide

---

### P3 - Low (Future Enhancements)

**10. Multi-Agent Support**
- Subagent spawning
- Parallel tool execution
- Task decomposition

**11. Performance Optimization**
- Benchmark suite
- Streaming optimizations
- Lazy loading

**12. Advanced Features**
- Web UI
- VS Code extension
- Custom tool plugins

---

## 📝 Immediate Action Items

**FOR THE USER:**

1. **Merge all fix branches to main** - No more branch switching until fixes are stable
   ```bash
   git checkout main
   git merge --no-ff fix/init-overwrite-guard
   git merge --no-ff fix/config-parse-errors  
   npm run build
   npm run test:validation
   ```

2. **Add pre-commit hook** - Prevent broken commits
   ```bash
   echo 'npm run test:validation' > .git/hooks/pre-commit
   chmod +x .git/hooks/pre-commit
   ```

3. **Use main for daily work** - Until all fixes are stable

**FOR DEVELOPMENT:**

1. ✅ Message sequence validator (2 hours)
2. ✅ Enhanced tool schemas with examples (3 hours)
3. ✅ Error recovery strategies (4 hours)
4. ✅ Modular system prompts (2 hours)
5. ✅ Context management basics (6 hours)

---

## 🎓 What Makes Claude Code "Mature"

1. **Reliability** - Works consistently across providers
2. **Robustness** - Graceful error handling
3. **Transparency** - User always knows what's happening
4. **Predictability** - Same input → same behavior
5. **Testability** - Comprehensive test coverage
6. **Maintainability** - Clear code, good docs
7. **Extensibility** - Easy to add features

**SCC has #3 (transparency) nailed. Everything else needs work.**

The #1 blocker right now is **branch management** causing fixes to revert.
Once that's stable, the roadmap above gets you to Claude Code parity in ~30 hours of focused work.
