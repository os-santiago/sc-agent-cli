/**
 * Message sequence validator - ensures conversation state is valid.
 *
 * Catches common errors that break LLM response generation:
 * - Tool results with wrong role
 * - Orphaned tool_call_ids
 * - Invalid message sequences
 */

import type { Message, ToolCall } from './types.js';
import { redactSecrets } from '../utils/secret-redaction.js';

export class MessageValidationError extends Error {
  constructor(
    message: string,
    public readonly messageIndex: number,
    public readonly invalidMessage: Message
  ) {
    super(`Message validation error at index ${messageIndex}: ${message}`);
    this.name = 'MessageValidationError';
  }
}

/**
 * #537 engine-protocol guard: `tool_calls[].function.arguments` must reach
 * the provider as a *valid JSON object string*. A model can emit malformed
 * JSON (truncated stream, bad escaping) or non-object JSON; the agent loop
 * already turns the failed `JSON.parse` into a tool-error result — but the
 * assistant message carrying the raw arguments stays in history, and
 * providers that validate tool_calls on every request (e.g. NVIDIA NIM:
 * "messages[N].tool_calls[i].function.arguments must be a valid JSON object
 * string") reject the next call with a 400 that recurs deterministically on
 * every retry with the same context, killing the run as `provider_error`.
 *
 * `sanitizeToolCallArguments` repairs a single tool call for *history/wire*
 * copies: valid args pass through untouched (same reference), object-typed
 * args re-serialize losslessly, and anything else is replaced by a valid
 * placeholder object keyed by `MALFORMED_TOOL_ARGS_MARKER` so the signature
 * stays greppable in session traces while the bounded raw preview aids
 * postmortems. Tool execution always sees the raw provider response — only
 * what enters `messages` (provider context, sessions, checkpoints) is
 * repaired.
 */
export const MALFORMED_TOOL_ARGS_MARKER = '__sc_malformed_tool_args__';
const MALFORMED_ARGS_PREVIEW_CHARS = 400;

/** true when `arguments` is a JSON string decoding to a plain object. */
export function isValidToolArguments(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Return `call` unchanged when its `function.arguments` is a valid JSON
 * object string; otherwise return a copy repaired for history/the wire.
 */
export function sanitizeToolCallArguments(call: ToolCall): ToolCall {
  const raw: unknown = call.function?.arguments;
  if (isValidToolArguments(raw)) return call;

  // Some OpenAI-compatible providers emit arguments pre-parsed (a JSON
  // object rather than a string) — repair losslessly by re-serializing.
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      ...call,
      function: { name: call.function?.name ?? '', arguments: JSON.stringify(raw) },
    };
  }

  const preview = redactSecrets(String(raw ?? '').slice(0, MALFORMED_ARGS_PREVIEW_CHARS));
  return {
    ...call,
    function: {
      name: call.function?.name ?? '',
      arguments: JSON.stringify({ [MALFORMED_TOOL_ARGS_MARKER]: preview }),
    },
  };
}

/**
 * Validates a sequence of messages for correctness.
 * Throws MessageValidationError if sequence is invalid.
 */
export function validateMessageSequence(messages: Message[]): void {
  const pendingToolCalls = new Map<string, { index: number; name: string }>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Rule 1: Messages with tool_call_id MUST have role 'tool', not 'assistant'
    if (msg.tool_call_id) {
      if (msg.role !== 'tool') {
        throw new MessageValidationError(
          `Tool result must have role:'tool', not role:'${msg.role}'. ` +
            `This violates OpenAI API spec and breaks response generation with some providers.`,
          i,
          msg
        );
      }

      // Rule 2: Tool results must reference a valid tool_call_id
      const pendingCall = pendingToolCalls.get(msg.tool_call_id);
      if (!pendingCall) {
        throw new MessageValidationError(
          `Tool result references unknown tool_call_id '${msg.tool_call_id}'. ` +
            `Every tool result must match a prior tool call.`,
          i,
          msg
        );
      }

      // Mark this tool call as resolved
      pendingToolCalls.delete(msg.tool_call_id);
    }

    // Rule 3: Register tool calls when assistant makes them
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        if (pendingToolCalls.has(toolCall.id)) {
          throw new MessageValidationError(
            `Duplicate tool_call_id '${toolCall.id}'. Each tool call must have a unique ID.`,
            i,
            msg
          );
        }
        pendingToolCalls.set(toolCall.id, {
          index: i,
          name: toolCall.function.name,
        });
      }
    }

    // Rule 4: System messages should only be at the start
    if (msg.role === 'system' && i > 0) {
      const prevNonSystem = messages.slice(0, i).find((m) => m.role !== 'system');
      if (prevNonSystem) {
        throw new MessageValidationError(
          `System message found after non-system messages. ` +
            `System messages should only appear at the conversation start.`,
          i,
          msg
        );
      }
    }
  }

  // Rule 5: All tool calls should have responses (warning only, not error)
  if (pendingToolCalls.size > 0) {
    const unresolvedCalls = Array.from(pendingToolCalls.entries())
      .map(([_id, info]) => `${info.name} (index ${info.index})`)
      .join(', ');

    // This is a warning, not an error - some models might send incomplete sequences
    console.warn(
      `[MessageValidator] Warning: ${pendingToolCalls.size} tool calls without results: ${unresolvedCalls}`
    );
  }
}

/**
 * Auto-corrects common message sequence errors.
 * Returns corrected message array.
 *
 * ONLY use this for known safe corrections. Throws for unsafe errors.
 */
export function autoCorrectMessageSequence(messages: Message[]): Message[] {
  const corrected: Message[] = [];
  const seenToolCallIds = new Set<string>();

  for (const msg of messages) {
    // Auto-fix: Change role:'assistant' to role:'tool' for tool results
    if (msg.tool_call_id && msg.role === 'assistant') {
      console.warn(
        `[MessageValidator] Auto-correcting: changing role:'assistant' to role:'tool' ` +
          `for tool result ${msg.tool_call_id}`
      );
      corrected.push({ ...msg, role: 'tool' });
      continue;
    }

    // Track tool calls — and auto-fix malformed arguments (#537): a history
    // restored from disk (session/checkpoint) can already carry a call whose
    // arguments are not a valid JSON object string, which providers reject
    // with a deterministic 400 on every send. Repair it here — before the
    // wire — so the run survives; the paired tool result already tells the
    // model the call failed.
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        seenToolCallIds.add(toolCall.id);
      }
      corrected.push({ ...msg, tool_calls: msg.tool_calls.map(sanitizeToolCallArguments) });
      continue;
    }

    corrected.push(msg);
  }

  // Validate the corrected sequence
  validateMessageSequence(corrected);

  return corrected;
}

/**
 * Quick check: returns true if sequence looks valid.
 * Use this for fast checks without throwing.
 */
export function isMessageSequenceValid(messages: Message[]): boolean {
  try {
    validateMessageSequence(messages);
    return true;
  } catch {
    return false;
  }
}