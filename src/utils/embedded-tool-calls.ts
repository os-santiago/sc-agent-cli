import type { ToolCall } from '../core/types.js';
import { hasHarmonyMarkup, recoverHarmonyToolCalls } from './harmony-format.js';

/**
 * Embedded tool-call markup recovery (#533).
 *
 * Providers routing tag-structured models — devin/swe-2-class gateways (the
 * wire contract streams a `summary` reasoning envelope and tool invocations
 * through a native action channel), Hermes/llama.cpp shims, and
 * Anthropic-style adapters — can leak tool invocations into assistant
 * `content` as XML-ish markup instead of the structured `tool_calls` field.
 * Left unhandled, the agent loop treats that text as the final answer and
 * ends the turn with zero workspace mutations — a silent no-op for headless
 * callers (failure signature `scc:zero-mutations:*`).
 *
 * Recovered families (only consulted when the response carries NO
 * structured tool_calls — the structured field always wins):
 *
 *   - Harmony channel markup (#417), delegated to harmony-format.
 *   - Hermes/Qwen/llama.cpp blocks: <tool_call>{"name":"x","arguments":{…}}
 *     </tool_call>, attribute form <tool_call name="x">{…}</tool_call>, and
 *     name-on-first-line form <tool_call>x\n{…}</tool_call>.
 *   - Anthropic-style invokes (optionally namespaced, e.g. antml:invoke and
 *     wrapped in a function_calls container): <invoke name="x"><parameter
 *     name="k">v</parameter></invoke>.
 *   - Llama function tags: <function=x>{…}</function>, <function name="x">
 *     {…}</function>, and <function_call>{…}</function_call>.
 *
 * Benign tag-structured prose (<summary>, <details>, <thinking> reports) is
 * deliberately NOT action markup — it flows through the normal no-tool-call
 * turn-end path where the zero-mutation guard decides.
 */

/** Opening tags that mark content as carrying tool-call markup. */
const ACTION_MARKUP_RE =
  /<\|channel\||<\/?(?:[a-zA-Z][\w-]*:)?(?:tool_call|invoke|function_calls|function_call)\b|<function[\s=>]/i;

/**
 * True when `content` carries recognizable tool-invocation markup. Used by
 * the agent loop to decide between executing recovered calls, re-prompting
 * the model for a structured `tool_calls` field, or treating the text as a
 * plain answer.
 */
export function hasEmbeddedActionMarkup(content: string | undefined | null): boolean {
  return typeof content === 'string' && ACTION_MARKUP_RE.test(content);
}

function attrValue(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/** Coerce a parsed payload's args field to the JSON string the tool contract expects. */
function argsFieldToString(raw: unknown): string {
  if (raw === undefined || raw === null) return '{}';
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return '{}';
  }
}

/**
 * Parse a raw payload string into an arguments JSON string. Non-JSON text is
 * wrapped as `{ input: <raw> }` so the model still sees a structured argument
 * set; empty payloads yield no call (mirrors harmony-format semantics).
 */
function payloadToArgs(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return JSON.stringify({ input: trimmed });
  }
}

function makeCall(name: string, args: string, seq: number): ToolCall {
  return {
    id: `embedded_${seq}_${Math.random().toString(36).slice(2, 10)}`,
    type: 'function',
    function: { name, arguments: args },
  };
}

/**
 * Turn one parsed JSON payload into zero or more tool calls. Handles the
 * payload shapes found inside markup blocks:
 *   - {"name": "x", "arguments"|"parameters"|"args"|"input": …}
 *   - {"function": {"name": "x", "arguments": …}}          (OpenAI wire shape)
 *   - {"tool_calls": [ …entries… ]} or a bare array         (call envelopes)
 *   - any other object + an attribute/tag-derived name       (object IS args)
 */
function collectCallsFromPayload(
  payload: unknown,
  out: Array<{ name: string; args: string }>,
  tagName?: string | null,
): void {
  if (payload === null || payload === undefined) return;
  if (Array.isArray(payload)) {
    for (const item of payload) collectCallsFromPayload(item, out, tagName);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as Record<string, unknown>;

  if (Array.isArray(obj.tool_calls)) {
    collectCallsFromPayload(obj.tool_calls, out, tagName);
    return;
  }

  const fn = obj.function && typeof obj.function === 'object'
    ? (obj.function as Record<string, unknown>)
    : null;
  const name =
    (typeof obj.name === 'string' && obj.name) ||
    (fn && typeof fn.name === 'string' && fn.name) ||
    tagName ||
    null;
  if (!name) return;

  const rawArgs =
    obj.arguments ?? obj.parameters ?? obj.args ?? obj.input ??
    (fn ? (fn.arguments ?? fn.parameters ?? fn.args ?? fn.input) : undefined) ??
    (tagName && !('arguments' in obj) && !('parameters' in obj) && !('args' in obj) && !('input' in obj) && !fn
      ? obj
      : undefined);
  out.push({ name, args: argsFieldToString(rawArgs) });
}

/**
 * Recover invocations from `<tool_call>…</tool_call>` blocks. Payloads may
 * be a JSON call object/envelope, a bare args object combined with a
 * `name=` attribute, or a tool name on the first line followed by args.
 */
function recoverToolCallBlocks(content: string, out: Array<{ name: string; args: string }>): void {
  const re = /<tool_call\b([^>]*)>([\s\S]*?)<\/tool_call\s*>/gi;
  for (const m of content.matchAll(re)) {
    const attrs = m[1] ?? '';
    const body = (m[2] ?? '').trim();
    const tagName = attrValue(attrs, 'name');
    if (!body && !tagName) continue;
    if (!body && tagName) {
      out.push({ name: tagName, args: '{}' });
      continue;
    }
    try {
      collectCallsFromPayload(JSON.parse(body), out, tagName);
      continue;
    } catch {
      // not JSON — fall through to name-line / raw-input handling
    }
    const nameLine = body.match(/^([A-Za-z_][\w.-]*)\s*(?:\n|\r\n)([\s\S]*)$/);
    if (nameLine) {
      const args = payloadToArgs(nameLine[2] ?? '');
      if (args !== null) out.push({ name: nameLine[1], args });
      continue;
    }
    if (tagName) {
      const args = payloadToArgs(body);
      if (args !== null) out.push({ name: tagName, args });
    }
  }
}

/**
 * Recover invocations from `<invoke name="x">…</invoke>` blocks (Anthropic
 * style, optionally namespaced or nested in a `<function_calls>` container).
 * `<parameter name="k">v</parameter>` children become the args object; a
 * parameter-free body is parsed as JSON args or wrapped as `{ input }`.
 */
function recoverInvokeBlocks(content: string, out: Array<{ name: string; args: string }>): void {
  const invokeRe = /<(?:[a-zA-Z][\w-]*:)?invoke\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z][\w-]*:)?invoke\s*>/gi;
  const paramRe = /<(?:[a-zA-Z][\w-]*:)?parameter\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z][\w-]*:)?parameter\s*>/gi;
  for (const m of content.matchAll(invokeRe)) {
    const name = attrValue(m[1] ?? '', 'name');
    if (!name) continue;
    const body = m[2] ?? '';
    const params: Record<string, unknown> = {};
    let paramCount = 0;
    for (const p of body.matchAll(paramRe)) {
      const key = attrValue(p[1] ?? '', 'name');
      if (key) {
        params[key] = (p[2] ?? '').trim();
        paramCount++;
      }
    }
    if (paramCount > 0) {
      out.push({ name, args: JSON.stringify(params) });
      continue;
    }
    const args = payloadToArgs(body);
    if (args !== null) out.push({ name, args });
  }
}

/**
 * Recover invocations from `<function=x>{…}</function>`,
 * `<function name="x">{…}</function>`, and
 * `<function_call>{…}</function_call>` blocks.
 */
function recoverFunctionBlocks(content: string, out: Array<{ name: string; args: string }>): void {
  const eqRe = /<function\s*=\s*([A-Za-z_][\w.-]*)\s*>([\s\S]*?)<\/function\s*>/gi;
  for (const m of content.matchAll(eqRe)) {
    const args = payloadToArgs(m[2] ?? '');
    if (args !== null) out.push({ name: m[1], args });
  }
  const namedRe = /<function\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/function\s*>/gi;
  for (const m of content.matchAll(namedRe)) {
    const name = m[1] ?? m[2] ?? m[3];
    if (!name) continue;
    const args = payloadToArgs(m[4] ?? '');
    if (args !== null) out.push({ name, args });
  }
  const callRe = /<function_call\b([^>]*)>([\s\S]*?)<\/function_call\s*>/gi;
  for (const m of content.matchAll(callRe)) {
    const attrs = m[1] ?? '';
    const body = (m[2] ?? '').trim();
    const tagName = attrValue(attrs, 'name');
    if (!body && tagName) {
      out.push({ name: tagName, args: '{}' });
      continue;
    }
    try {
      collectCallsFromPayload(JSON.parse(body), out, tagName);
    } catch {
      if (tagName) {
        const args = payloadToArgs(body);
        if (args !== null) out.push({ name: tagName, args });
      }
    }
  }
}

/**
 * Recover every tool call embedded as markup in `content`. Harmony channel
 * blocks are delegated to the #417 recovery; the XML-ish families are parsed
 * here. Returns calls in document order per family (harmony first — its
 * blocks cannot co-occur inside the XML envelopes).
 */
export function recoverEmbeddedToolCalls(content: string): ToolCall[] {
  const parsed: Array<{ name: string; args: string }> = [];
  if (typeof content !== 'string' || !content) return [];

  const calls: ToolCall[] = [];
  if (hasHarmonyMarkup(content)) {
    calls.push(...recoverHarmonyToolCalls(content));
  }

  recoverToolCallBlocks(content, parsed);
  recoverInvokeBlocks(content, parsed);
  recoverFunctionBlocks(content, parsed);
  for (const p of parsed) {
    calls.push(makeCall(p.name, p.args, calls.length));
  }
  return calls;
}
