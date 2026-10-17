import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MAX_TOTAL_EMPTY_RESPONSES,
  MAX_CONSECUTIVE_EMPTY_RESPONSES,
  EMPTY_RESPONSE_REPROMPT,
  isEmptyModelResponse,
  shouldAbortOnEmpty,
  buildEmptyResponseError,
  buildLivelockError,
  MAX_SELF_HEAL,
  analyzeProseResponse,
  shouldSelfHeal,
  buildSelfHealReprompt,
  DEFAULT_ZERO_MUTATION_REPROMPTS,
  resolveZeroMutationRepromptBudget,
  countWorkspaceMutations,
  shouldRepromptZeroMutation,
  buildZeroMutationReprompt,
  HARMONY_CHANNEL_TAG,
  HARMONY_MESSAGE_TAG,
  MAX_HARMONY_REPROMPTS,
  buildHarmonyReprompt,
  buildHarmonyError,
} from './guards.js';
import type { ToolUseRecord } from './tool-execution.js';

// --- Empty-response guard ---------------------------------------------------

test('isEmptyModelResponse detects missing content and tool calls', () => {
  assert.equal(isEmptyModelResponse({}), true);
  assert.equal(isEmptyModelResponse({ content: '' }), true);
  assert.equal(isEmptyModelResponse({ content: '   ' }), true);
  assert.equal(isEmptyModelResponse({ content: null, tool_calls: [] }), true);
  assert.equal(isEmptyModelResponse({ content: 'answer' }), false);
  assert.equal(isEmptyModelResponse({ content: '', tool_calls: [{ id: 't1' }] }), false);
});

test('shouldAbortOnEmpty enforces both the consecutive and total thresholds', () => {
  assert.equal(shouldAbortOnEmpty(MAX_TOTAL_EMPTY_RESPONSES - 1, MAX_CONSECUTIVE_EMPTY_RESPONSES - 1), false);
  assert.equal(shouldAbortOnEmpty(MAX_TOTAL_EMPTY_RESPONSES, 1), true);
  assert.equal(shouldAbortOnEmpty(1, MAX_CONSECUTIVE_EMPTY_RESPONSES), true);
});

test('buildEmptyResponseError explains the compatibility guidance', () => {
  const err = buildEmptyResponseError(5, 12);
  assert.match(err.message, /empty response 5 times in 12 iterations/);
  assert.match(err.message, /model compatibility issue/);
  assert.match(err.message, /stream: false/);
});

test('EMPTY_RESPONSE_REPROMPT instructs the model to answer or call a tool', () => {
  assert.match(EMPTY_RESPONSE_REPROMPT, /empty response/);
  assert.match(EMPTY_RESPONSE_REPROMPT, /call a tool/i);
});

// --- Livelock guard ---------------------------------------------------------

test('buildLivelockError embeds the streak size and a trimmed output sample', () => {
  const err = buildLivelockError(3, 9, 'x'.repeat(400));
  assert.match(err.message, /SC_LIVELOCK/);
  assert.match(err.message, /3 consecutive responses/);
  assert.match(err.message, /9 iterations/);
  // Output sample is trimmed to 300 chars inside the quotes
  assert.ok(err.message.includes('"' + 'x'.repeat(300) + '"'));
  assert.ok(!err.message.includes('x'.repeat(301)));
});

// --- Self-heal guard --------------------------------------------------------

test('analyzeProseResponse flags conversational replies without future actions', () => {
  const signals = analyzeProseResponse('Hello! How can I help you today?', { autoApprove: false, hasToolRun: false });
  assert.equal(signals.isConversational, true);
  assert.equal(signals.isShortResponse, true);
  assert.equal(signals.isFutureIntention, false);
});

test('analyzeProseResponse marks future intentions only under autoApprove', () => {
  const content = 'I will now fix the failing test by editing the file.';
  const interactive = analyzeProseResponse(content, { autoApprove: false, hasToolRun: false });
  assert.equal(interactive.isFutureIntention, false);
  const unattended = analyzeProseResponse(content, { autoApprove: true, hasToolRun: false });
  assert.equal(unattended.isFutureIntention, true);
  // Greeting + future action is not "conversational" — the model intends to act
  const mixed = analyzeProseResponse('Hello! I will fix the file now.', { autoApprove: true, hasToolRun: false });
  assert.equal(mixed.isConversational, false);
});

test('analyzeProseResponse detects error indicators and failure phrases', () => {
  const signals = analyzeProseResponse('The build reports: compilation error in main.ts', { autoApprove: false, hasToolRun: true });
  assert.equal(signals.hasErrorIndicators, true);
  assert.equal(signals.hasFailurePhrase, true);
});

test('shouldSelfHeal fires on failure prose but honors suppression and the cap', () => {
  const failing = analyzeProseResponse('The build reports: compilation error in main.ts', { autoApprove: false, hasToolRun: true });
  assert.equal(shouldSelfHeal(failing, { suppressGuards: false, hasToolRun: true, selfHealCount: 0 }), true);
  // Phase-suppressed runs (planner/reviewer) never self-heal
  assert.equal(shouldSelfHeal(failing, { suppressGuards: true, hasToolRun: true, selfHealCount: 0 }), false);
  // Budget cap
  assert.equal(shouldSelfHeal(failing, { suppressGuards: false, hasToolRun: true, selfHealCount: MAX_SELF_HEAL }), false);
  assert.equal(shouldSelfHeal(failing, { suppressGuards: false, hasToolRun: true, selfHealCount: 4, maxSelfHeal: 5 }), true);
  assert.equal(shouldSelfHeal(failing, { suppressGuards: false, hasToolRun: true, selfHealCount: 5, maxSelfHeal: 5 }), false);
});

test('shouldSelfHeal skips purely conversational/short responses', () => {
  const chat = analyzeProseResponse('Hi! Nice to meet you.', { autoApprove: false, hasToolRun: false });
  assert.equal(shouldSelfHeal(chat, { suppressGuards: false, hasToolRun: false, selfHealCount: 0 }), false);
});

test('buildSelfHealReprompt lists failed tools and pushes a different approach', () => {
  const toolsUsed: ToolUseRecord[] = [
    { name: 'run_shell', success: false, error: 'exit 127: command not found' },
    { name: 'read_file', success: true },
  ];
  const prompt = buildSelfHealReprompt({
    selfHealCount: 2,
    iteration: 7,
    toolsUsed,
    autoApprove: false,
    isFutureIntention: false,
    isDeferring: false,
  });
  assert.match(prompt, /\[SELF-HEAL 2\/10 — iteration 7\]/);
  assert.match(prompt, /run_shell/);
  assert.match(prompt, /DIFFERENT approach/);
});

test('buildSelfHealReprompt under autoApprove demands execution, not narration', () => {
  const prompt = buildSelfHealReprompt({
    selfHealCount: 1,
    iteration: 3,
    toolsUsed: [],
    autoApprove: true,
    isFutureIntention: true,
    isDeferring: false,
  });
  assert.match(prompt, /did not execute any tools/);
  assert.match(prompt, /auto-approve mode/);
});

// --- Zero-mutation completion guard -----------------------------------------

test('resolveZeroMutationRepromptBudget parses env or falls back to the default', () => {
  assert.equal(resolveZeroMutationRepromptBudget({}), DEFAULT_ZERO_MUTATION_REPROMPTS);
  assert.equal(resolveZeroMutationRepromptBudget({ SC_ZERO_MUTATION_REPROMPTS: '7' }), 7);
  assert.equal(resolveZeroMutationRepromptBudget({ SC_ZERO_MUTATION_REPROMPTS: 'abc' }), DEFAULT_ZERO_MUTATION_REPROMPTS);
  assert.equal(resolveZeroMutationRepromptBudget({ SC_ZERO_MUTATION_REPROMPTS: '0' }), 0);
  assert.equal(resolveZeroMutationRepromptBudget({ SC_ZERO_MUTATION_REPROMPTS: '-3' }), 0);
});

test('countWorkspaceMutations counts successful workspace-mutating calls only', () => {
  const toolsUsed: ToolUseRecord[] = [
    { name: 'write_file', success: true, args: { path: 'a.ts', content: 'x' } },
    { name: 'write_file', success: false, args: { path: 'b.ts' }, error: 'denied' },
    { name: 'memory_write', success: true, args: { key: 'k', content: 'v' } },
    { name: 'read_file', success: true, args: { path: 'a.ts' } },
    { name: 'run_shell', success: true, args: { command: 'mkdir out' } },
  ];
  // write_file (ok) + run_shell mkdir (ok) = 2; failed write, memory_write
  // and read-only calls do not count.
  assert.equal(countWorkspaceMutations(toolsUsed), 2);
});

test('shouldRepromptZeroMutation requires unattended run, mutation intent, and no mutations', () => {
  const base = {
    suppressGuards: false,
    unattendedRun: true,
    repromptsUsed: 0,
    repromptBudget: 2,
    mutatingCalls: 0,
    userMessage: 'fix the bug in src/main.ts',
    content: 'I would fix it by editing the file.',
    worktreeChanged: false,
  };
  assert.equal(shouldRepromptZeroMutation(base), true);
  // Interactive sessions never hit this guard
  assert.equal(shouldRepromptZeroMutation({ ...base, unattendedRun: false }), false);
  // Phase-suppressed
  assert.equal(shouldRepromptZeroMutation({ ...base, suppressGuards: true }), false);
  // Budget exhausted
  assert.equal(shouldRepromptZeroMutation({ ...base, repromptsUsed: 2 }), false);
  // A mutating tool already ran
  assert.equal(shouldRepromptZeroMutation({ ...base, mutatingCalls: 1 }), false);
  // Read-only prompt
  assert.equal(shouldRepromptZeroMutation({ ...base, userMessage: 'explain what src/main.ts does' }), false);
  // Explicit no-changes verdict honored
  assert.equal(shouldRepromptZeroMutation({ ...base, content: 'No changes are required — the fix is already applied.' }), false);
  // Worktree changed through an unclassified path (e.g. shell heredoc write)
  assert.equal(shouldRepromptZeroMutation({ ...base, worktreeChanged: true }), false);
});

test('buildZeroMutationReprompt embeds the counter and the execute-dont-narrate rule', () => {
  const prompt = buildZeroMutationReprompt(1, 2, 8);
  assert.match(prompt, /\[ZERO-MUTATION 1\/2 — iteration 8\]/);
  assert.match(prompt, /ZERO workspace changes/);
  assert.match(prompt, /Do NOT describe or paste the fix in prose/);
});

// --- Harmony-format recovery ------------------------------------------------

test('harmony tag constants resolve to the real markup tokens', () => {
  // Tags are spelled via concatenation so the literal markup never appears
  // in source (it gets stripped by some toolchains).
  assert.equal(HARMONY_CHANNEL_TAG, '<' + '|channel|>');
  assert.equal(HARMONY_MESSAGE_TAG, '<' + '|message|>');
});

test('buildHarmonyReprompt names the malformed markup and the retry counter', () => {
  const prompt = buildHarmonyReprompt(2);
  assert.match(prompt, new RegExp(`\\[MALFORMED TOOL CALL 2/${MAX_HARMONY_REPROMPTS}\\]`));
  assert.ok(prompt.includes(HARMONY_CHANNEL_TAG));
  assert.ok(prompt.includes(HARMONY_MESSAGE_TAG));
});

test('buildHarmonyError explains the provider format incompatibility', () => {
  const err = buildHarmonyError(3);
  assert.match(err.message, /Harmony markup tool calls inside content 3 times/);
  assert.match(err.message, /format incompatibility/);
  assert.match(err.message, /stream: false/);
});