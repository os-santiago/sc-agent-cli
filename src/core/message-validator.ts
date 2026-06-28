/**
 * Message sequence validator - ensures conversation state is valid.
 *
 * Catches common errors that break LLM response generation:
 * - Tool results with wrong role
 * - Orphaned tool_call_ids
 * - Invalid message sequences
 */

import type { Message } from './types.js';

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
      .map(([id, info]) => `${info.name} (index ${info.index})`)
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

    // Track tool calls
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        seenToolCallIds.add(toolCall.id);
      }
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
  } catch (error) {
    return false;
  }
}
