import type { Message, ToolCall } from '../types.js';
import { redactSecrets } from '../../utils/secret-redaction.js';

export function compressOldMessages(
  messages: Message[],
  keepRecentCount: number = 30,
  maxToolLength: number = 300
): Message[] {
  if (messages.length <= keepRecentCount * 2) return messages;

  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');
  const keepCount = Math.min(keepRecentCount, Math.floor(nonSystem.length / 2));
  const recentMessages = nonSystem.slice(-keepCount * 2);
  const oldMessages = nonSystem.slice(0, nonSystem.length - keepCount * 2);

  const compressed: Message[] = [];

  for (const msg of oldMessages) {
    if (msg.role === 'tool') {
      const originalLength = msg.content.length;
      if (originalLength > maxToolLength) {
        const start = msg.content.substring(0, maxToolLength);
        compressed.push({
          ...msg,
          content: `${start}\n\n... [Tool output compressed: ${originalLength} chars → ${maxToolLength} chars] ...`,
        });
        continue;
      }
    }
    if (msg.role === 'assistant' && !msg.tool_calls && msg.content.length > maxToolLength * 2) {
      compressed.push({
        ...msg,
        content: msg.content.substring(0, maxToolLength * 2) +
          `\n\n... [Assistant response compressed: ${msg.content.length} chars → ${maxToolLength * 2} chars] ...`,
      });
      continue;
    }
    compressed.push(msg);
  }

  return [...systemMsgs, ...compressed, ...recentMessages];
}

export function pruneMessageHistory(messages: Message[], keepCount: number = 10, maxLength: number = 600): Message[] {
  let toolMessageCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') {
      toolMessageCount++;
    }
  }

  let toolMessagesSeen = 0;
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      toolMessagesSeen++;
      const isOldToolMessage = (toolMessageCount - toolMessagesSeen) >= keepCount;
      if (isOldToolMessage && msg.content && msg.content.length > maxLength) {
        const originalLength = msg.content.length;
        const startPreview = msg.content.substring(0, 300);
        const endPreview = msg.content.substring(msg.content.length - 300);
        return {
          ...msg,
          content: `${startPreview}\n\n... [Tool output of ${originalLength} characters truncated to save context window] ...\n\n${endPreview}`,
        };
      }
    }
    return msg;
  });
}

export function limitMessageHistory(messages: Message[], maxMessages: number = 60): Message[] {
  if (messages.length <= maxMessages) return messages;

  const systemMessage = messages.find((m) => m.role === 'system');
  // Find the original user prompt (first 'user' message in the history)
  const firstUserIndex = messages.findIndex((m) => m.role === 'user');
  const firstUserMessage = firstUserIndex !== -1 ? messages[firstUserIndex] : undefined;

  const targetStartIndex = messages.length - maxMessages;

  // Find a safe start index at or before targetStartIndex.
  // We want to slice right before an 'assistant' or 'user' message to avoid orphaning tool results.
  let safeIndex = targetStartIndex;
  while (safeIndex > 0) {
    const role = messages[safeIndex].role;
    if (role === 'assistant' || role === 'user') {
      break;
    }
    safeIndex--;
  }

  // If we scanned all the way to the start, just return the messages
  if (safeIndex <= 0) {
    return messages;
  }

  const sliced = messages.slice(safeIndex);
  const result: Message[] = [];

  if (systemMessage) {
    result.push(systemMessage);
  }

  // If the first message in the sliced segment is not a user message, we prepend
  // the user's original query. This guarantees the conversation starts with a 'user'
  // role (after the system prompt), which is a strict requirement for some API gateways.
  if (firstUserMessage && sliced[0].role !== 'user') {
    if (sliced[0] !== firstUserMessage) {
      result.push(firstUserMessage);
    }
  }

  result.push(...sliced);
  return result;
}

/**
 * Auto-compress giant tool results before adding to history to prevent
 * memory saturation. Keeps a 5000-char head + 3000-char tail.
 */
export const MAX_TOOL_RESULT_CHARS = 10 * 1024;

export function compressToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const start = content.substring(0, 5000);
  const end = content.substring(content.length - 3000);
  return `${start}\n\n[... Tool output compressed: ${content.length} chars → 8000 chars to prevent memory saturation ...]\n\n${end}`;
}

/**
 * Synthesis nudge appended to the LAST tool result when the model responded
 * with tool calls and no text. Some models (NVIDIA Nemotron, older Llama)
 * don't auto-generate synthesis — the instruction is inlined into the tool
 * message so the strict API role sequence (user → assistant → tool →
 * assistant) holds for picky gateways (Anthropic, NVIDIA NIM).
 */
export const TOOL_RESULT_SYNTHESIS_NUDGE =
  '\n\n[Instruction: Analyze the tool results above. If the task is not yet complete, proceed with the next steps or tool calls to complete the task. Otherwise, summarize the results for the user in natural language. If there were errors, explain what happened and take action to fix them.]';

// #472 secret redaction: the history copy of a tool call carries masked
// arguments (write_file content, run_shell commands can embed secrets).
// `response.tool_calls` stays raw — the model's args must execute verbatim;
// only what enters `messages` (provider context, sessions, checkpoints)
// is masked.
export function redactToolCall(call: ToolCall): ToolCall {
  return { ...call, function: { ...call.function, arguments: redactSecrets(call.function.arguments) } };
}
