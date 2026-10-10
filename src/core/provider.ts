import type {
  Message,
  ModelConfig,
  ToolDefinition,
  StreamDelta,
  ToolCall,
} from './types.js';
import { verboseApiRequest, verboseApiResponse, verbose, verboseError } from '../utils/verbose-logger.js';
import type { ThrottleConfig } from './types.js';
import { sleep, calculateDelay } from '../utils/throttle.js';
import {
  MAX_ATTEMPTS_PER_CANDIDATE,
  ProviderFailoverError,
  ProviderHttpError,
  ProviderTimeoutError,
  classifyProviderError,
  computeRetryDelay,
  primaryCandidate,
  resolveProviderTimeouts,
} from './failover.js';
import type { CandidateAttempt, FailoverCandidate } from './failover.js';

export interface ChatCompletionOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  stream?: boolean;
  signal?: AbortSignal;
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}

/** Provider-reported token usage (#424) — present when the API returns it. */
export interface ProviderUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface ChatCompletionResponse {
  content: string;
  tool_calls?: ToolCall[];
  /** Real token counts when the provider reports them (non-streamed always;
   *  streamed when the provider honors stream_options.include_usage). */
  usage?: ProviderUsage;
}

/**
 * Synthetic accumulation slot base for index-less wire tool calls — far
 * above any real `index` value so normalized calls never collide with
 * conformant indexed ones (#533).
 */
const SYNTHETIC_INDEX_BASE = 1_000_000;

/** A tool call as decoded from the wire, before slot/index semantics apply. */
interface WireToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Coerce a wire `arguments` payload to the JSON string the tool contract
 * expects. OpenAI sends a string; Anthropic-style adapters and some shims
 * deliver the already-parsed object (#533).
 */
function wireArgsToString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return '';
  try {
    return JSON.stringify(raw);
  } catch {
    return '';
  }
}

/**
 * Normalize provider tool-call payloads into a uniform list. OpenAI sends
 * `tool_calls` as an array of `{index, id, function:{name, arguments}}`
 * fragments; shims over non-OpenAI protocols (devin/swe-2-class gateways,
 * Anthropic adapters, llama.cpp) may instead deliver a single object,
 * index-less calls, flattened `{name, arguments}` entries, or the legacy
 * `function_call` field (#533). Feeding such shapes into the accumulator
 * verbatim either throws (silently dropping every call in the chunk) or
 * collapses all calls into one slot, producing a turn that ends with zero
 * mutations (`scc:zero-mutations:*`).
 *
 * Frames carrying no index/id/name/args at all are keepalive noise and are
 * dropped; index-less frames keep `index: undefined` for the accumulator to
 * slot synthetically.
 */
function normalizeWireToolCalls(raw: unknown): WireToolCall[] {
  if (raw === null || raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const calls: WireToolCall[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const fn = e.function && typeof e.function === 'object'
      ? (e.function as Record<string, unknown>)
      : e;
    const name = typeof fn.name === 'string' ? fn.name : undefined;
    const args = wireArgsToString(fn.arguments ?? fn.parameters ?? fn.args ?? fn.input);
    const id = typeof e.id === 'string' ? e.id : undefined;
    if (name === undefined && args === '' && id === undefined) continue;
    calls.push({
      index: typeof e.index === 'number' && Number.isFinite(e.index) ? e.index : undefined,
      id,
      function: { name, arguments: args },
    });
  }
  return calls;
}

/**
 * Coerce a wire `content` payload to text plus any tool calls embedded as
 * content parts. Anthropic-shaped adapters deliver
 * `[{type:'text',…},{type:'tool_use',name,input}]` arrays where standard
 * OpenAI sends a plain string — treating the array as a string would mangle
 * it into `[object Object]` and silently drop the invocation (#533).
 */
function contentToText(raw: unknown): { text: string; toolCalls: WireToolCall[] } {
  if (typeof raw === 'string') return { text: raw, toolCalls: [] };
  if (!Array.isArray(raw)) return { text: '', toolCalls: [] };
  const parts: string[] = [];
  const toolCalls: WireToolCall[] = [];
  for (const part of raw) {
    if (typeof part === 'string') { parts.push(part); continue; }
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') {
      parts.push(p.text);
      continue;
    }
    if ((p.type === 'tool_use' || p.type === 'tool_call') && typeof p.name === 'string') {
      toolCalls.push({
        id: typeof p.id === 'string' ? p.id : undefined,
        function: { name: p.name, arguments: wireArgsToString(p.input ?? p.arguments) },
      });
    }
  }
  return { text: parts.join(''), toolCalls };
}

export class OpenAICompatibleProvider {
  private throttleConfig: ThrottleConfig = {
    enabled: false, minDelayMs: 0, afterEmptyResponse: 0, afterError: 0, maxDelayMs: 30000, mode: 'fixed',
  };
  private lastApiCallTime = 0;
  private consecutiveEmpty = 0;
  private lastCallWasError = false;
  private chain: FailoverCandidate[];
  private candidateCursor = 0;
  private lastUsed?: FailoverCandidate;
  private lastAttempts: CandidateAttempt[] = [];

  constructor(private config: ModelConfig) {
    this.chain = [primaryCandidate(config)];
  }

  setThrottleConfig(config: ThrottleConfig): void {
    this.throttleConfig = config;
  }

  setConsecutiveEmpty(count: number): void {
    this.consecutiveEmpty = count;
  }

  setLastCallWasError(err: boolean): void {
    this.lastCallWasError = err;
  }

  /**
   * Ordered provider/model cascade (#425). Candidate 0 is the configured
   * model; further entries come from SC_FAILOVER. The cursor is sticky and
   * forward-only: once a candidate wins, later calls start at it, so a dead
   * upstream candidate is not re-tried on every request.
   */
  setFailoverChain(chain: FailoverCandidate[]): void {
    if (chain.length === 0) return;
    this.chain = chain;
    this.candidateCursor = 0;
  }

  /** "provider/model" label of the candidate that served the last call. */
  get providerUsed(): string | null {
    return this.lastUsed?.id ?? null;
  }

  /** Failed-attempt records of the most recent call (for the run manifest). */
  get failoverAttempts(): CandidateAttempt[] {
    return this.lastAttempts;
  }

  async chatCompletion(
    options: ChatCompletionOptions,
    onChunk?: (delta: StreamDelta) => void
  ): Promise<ChatCompletionResponse> {
    const attempts: CandidateAttempt[] = [];
    this.lastAttempts = attempts;
    const startIdx = Math.min(this.candidateCursor, this.chain.length - 1);
    let lastError: unknown;

    for (let ci = startIdx; ci < this.chain.length; ci++) {
      const candidate = this.chain[ci];
      try {
        const response = await this.callCandidate(candidate, options, onChunk, attempts);
        if (ci !== this.candidateCursor) {
          this.logFailover(`now using ${candidate.id} (was ${this.chain[this.candidateCursor].id})`);
        }
        this.candidateCursor = ci;
        this.lastUsed = candidate;
        return response;
      } catch (err) {
        if (options.signal?.aborted) throw err;
        lastError = err;
        const info = classifyProviderError(err);
        const next = this.chain[ci + 1];
        verbose(`[failover] ${candidate.id} failed [${info.errorClass}]${info.status ? ` http=${info.status}` : ''}${next ? ` — trying ${next.id}` : ''}`, 1);
        if (next) {
          this.logFailover(`${candidate.id} failed (${info.errorClass}) — trying ${next.id}`);
        }
      }
    }

    const info = classifyProviderError(lastError);
    throw new ProviderFailoverError(attempts, info.errorClass);
  }

  /**
   * One candidate's bounded retry loop: up to MAX_ATTEMPTS_PER_CANDIDATE
   * attempts (1 initial + 3 retries) with 2s→4s→8s +20% jitter backoff for
   * transient failures. Non-retryable errors (400/401/403, unsupported model)
   * throw immediately so the cascade advances.
   */
  private async callCandidate(
    candidate: FailoverCandidate,
    options: ChatCompletionOptions,
    onChunk: ((delta: StreamDelta) => void) | undefined,
    attempts: CandidateAttempt[],
  ): Promise<ChatCompletionResponse> {
    const { connectMs, attemptMs } = resolveProviderTimeouts(candidate.model);
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CANDIDATE; attempt++) {
      const started = Date.now();
      try {
        return await this.attemptOnce(candidate, options, onChunk, connectMs, attemptMs);
      } catch (err) {
        if (options.signal?.aborted) throw err;
        lastError = err;
        const info = classifyProviderError(err);
        attempts.push({
          candidate: candidate.id,
          attempt,
          errorClass: info.errorClass,
          retryable: info.retryable,
          status: info.status,
          error: info.message.slice(0, 400),
          durationMs: Date.now() - started,
        });
        verboseError(`API call failed (${candidate.id} attempt ${attempt}/${MAX_ATTEMPTS_PER_CANDIDATE}): ${info.message}`);
        if (!info.retryable || attempt === MAX_ATTEMPTS_PER_CANDIDATE) throw err;
        const delayMs = computeRetryDelay(attempt - 1);
        verbose(`Retrying ${candidate.id} in ${delayMs}ms (backoff)`, 2);
        await sleep(delayMs, options.signal);
      }
    }

    throw lastError;
  }

  /**
   * Exactly one HTTP attempt: dual timeout contract — connect timeout bounds
   * the time until response headers; attempt timeout bounds the whole
   * attempt including the streamed body. Both abort the attempt and surface
   * as retryable transport failures.
   */
  private async attemptOnce(
    candidate: FailoverCandidate,
    options: ChatCompletionOptions,
    onChunk: ((delta: StreamDelta) => void) | undefined,
    connectMs: number,
    attemptMs: number,
  ): Promise<ChatCompletionResponse> {
    const model = candidate.model;
    const rawBase = model.baseUrl.replace(/\/+$/, '');
    let baseUrl: string;
    try {
      baseUrl = new URL(rawBase).href.replace(/\/+$/, '');
    } catch {
      throw new Error(`Invalid baseUrl: "${model.baseUrl}" is not a valid URL`);
    }
    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (model.apiKey) {
      headers['Authorization'] = `Bearer ${model.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: model.model,
      messages: options.messages,
      temperature: model.temperature ?? 0.7,
      stream: options.stream ?? model.stream ?? true,
      tools: options.tools,
    };

    // Only send max_tokens if explicitly set (null/undefined = no limit, let provider decide)
    if (model.maxTokens !== null && model.maxTokens !== undefined) {
      body.max_tokens = model.maxTokens;
    }

    // Ask for a real usage chunk on the final streamed frame so per-role
    // token accounting (#424) can prefer reported counts over estimates.
    // Providers that don't support stream_options ignore unknown fields.
    if (body.stream === true) {
      body.stream_options = { include_usage: true };
    }

    if (options.tool_choice) {
      body.tool_choice = options.tool_choice;
    }

    // Apply throttling delay before the attempt. Pacing is deliberate waiting,
    // so it sits outside the attempt budget — the timers start with fetch.
    if (this.throttleConfig.enabled) {
      const delay = calculateDelay(
        this.throttleConfig,
        this.lastApiCallTime,
        this.consecutiveEmpty,
        this.lastCallWasError
      );
      if (delay > 0) {
        verbose(`Throttling: waiting ${delay}ms before API call (minDelay: ${this.throttleConfig.minDelayMs}ms, consecutiveEmpty: ${this.consecutiveEmpty}, lastError: ${this.lastCallWasError})`, 1);
        await sleep(delay, options.signal);
      }
    }

    const abortController = new AbortController();
    let timerReason: ProviderTimeoutError | undefined;
    const connectTimer = setTimeout(() => {
      timerReason = new ProviderTimeoutError('connect', connectMs);
      abortController.abort(timerReason);
    }, connectMs);
    const attemptTimer = setTimeout(() => {
      timerReason = new ProviderTimeoutError('attempt', attemptMs);
      abortController.abort(timerReason);
    }, attemptMs);
    let onAbort: (() => void) | null = null;

    try {
      if (options.signal) {
        if (options.signal.aborted) {
          throw options.signal.reason || new Error('Aborted');
        }
        onAbort = () => {
          abortController.abort(options.signal!.reason || new Error('Aborted'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      verbose(`Timeouts for ${candidate.id}: connect=${connectMs}ms attempt=${attemptMs}ms`, 2);
      verboseApiRequest(url, body);

      const requestStart = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: abortController.signal,
        });
      } finally {
        // fetch settles at response headers — the connect window is over.
        clearTimeout(connectTimer);
      }
      const responseDuration = Date.now() - requestStart;
      this.lastApiCallTime = Date.now();

      verboseApiResponse(response.status, responseDuration);

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderHttpError(response.status, errorText);
      }

      if (options.stream && response.body) {
        return await this.handleStreamResponse(response.body, onChunk);
      }
      return await this.handleNonStreamResponse(response);
    } catch (err) {
      // Normalize our own timeout aborts: some fetch implementations surface a
      // generic AbortError instead of the abort reason, losing the class.
      if (timerReason && abortController.signal.aborted && !options.signal?.aborted) {
        throw timerReason;
      }
      throw err;
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(attemptTimer);
      if (onAbort && options.signal) options.signal.removeEventListener('abort', onAbort);
    }
  }

  /** Provider transitions are operator-visible on stderr (stdout stays clean). */
  private logFailover(msg: string): void {
    console.error(`sc-agent: failover: ${msg}`);
  }

  private async handleNonStreamResponse(response: Response): Promise<ChatCompletionResponse> {
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No choices in response');
    }

    // Non-canonical shapes seen from protocol shims (#533): the payload may
    // arrive under `delta`, calls under the legacy `function_call` field or
    // as a non-array `tool_calls`, and content as typed parts carrying
    // `tool_use` blocks. Normalize everything into the standard contract.
    const msg = choice.message ?? choice.delta;
    const { text, toolCalls: contentCalls } = contentToText(msg?.content);
    const wireCalls = [
      ...contentCalls,
      ...normalizeWireToolCalls(msg?.tool_calls),
      ...normalizeWireToolCalls(msg?.function_call),
    ];
    const toolCalls: ToolCall[] = wireCalls.map((tc, i) => ({
      id: tc.id || `call_${i}`,
      type: 'function',
      function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
    }));

    return {
      content: text,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ?? undefined,
    };
  }

  private async handleStreamResponse(
    body: ReadableStream<Uint8Array>,
    onChunk?: (delta: StreamDelta) => void
  ): Promise<ChatCompletionResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let partialData = ''; // Buffers JSON from data: lines split across TCP chunks
    let fullContent = '';
    const accumulatedToolCalls: Map<number, ToolCall> = new Map();
    // Index-less wire calls are assigned synthetic slots; index-less
    // args-only fragments merge into the most recent slot (#533).
    let syntheticIndex = 0;
    let lastSlot = -1;
    let reportedUsage: ProviderUsage | undefined;

    function processChunk(data: string): boolean {
      try {
        const chunk = JSON.parse(data);
        // The usage frame arrives with empty choices on the last chunk when
        // the provider honors stream_options.include_usage (#424).
        if (chunk.usage && typeof chunk.usage === 'object') {
          reportedUsage = chunk.usage as ProviderUsage;
        }
        const choice = chunk.choices?.[0];
        // Some shims deliver message-shaped chunks (`choices[0].message`)
        // inside an SSE stream instead of the delta envelope (#533).
        const delta = choice?.delta ?? choice?.message;
        if (!delta || typeof delta !== 'object') return true;

        const { text, toolCalls: contentCalls } = contentToText(delta.content);
        if (text) fullContent += text;

        const rawCalls = [
          ...contentCalls,
          ...normalizeWireToolCalls(delta.tool_calls),
          ...normalizeWireToolCalls(delta.function_call),
        ];
        for (const tc of rawCalls) {
          const indexed = typeof tc.index === 'number';
          const hasIdentity = indexed || Boolean(tc.id) || Boolean(tc.function?.name);
          let slot: number;
          if (indexed) {
            slot = tc.index as number;
          } else if (hasIdentity) {
            slot = SYNTHETIC_INDEX_BASE + syntheticIndex++;
          } else if (lastSlot >= 0) {
            // Index-less args-only fragment — continuation of the previous
            // call (Anthropic-style input_json_delta relayed as entries).
            slot = lastSlot;
          } else {
            slot = SYNTHETIC_INDEX_BASE + syntheticIndex++;
          }
          lastSlot = slot;

          const existing = accumulatedToolCalls.get(slot);
          if (!existing) {
            accumulatedToolCalls.set(slot, {
              id: tc.id || '',
              type: 'function',
              function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
            });
            continue;
          }
          // Some shims re-send the completed call in a later frame — the
          // merge below is idempotent for exact repeats, so skip them.
          if (
            tc.id && tc.id === existing.id &&
            tc.function?.name === existing.function.name &&
            (tc.function?.arguments ?? '') === existing.function.arguments
          ) {
            continue;
          }
          if (tc.id && !existing.id) existing.id = tc.id;
          // Name fragments concatenate only when they differ — a re-sent
          // name (start frame followed by a complete frame) must not
          // duplicate it.
          if (tc.function?.name && tc.function.name !== existing.function.name) {
            existing.function.name += tc.function.name;
          }
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }

        if (onChunk) {
          onChunk({
            role: delta.role,
            content: typeof delta.content === 'string' ? delta.content : (text || undefined),
            tool_calls: rawCalls.length > 0
              ? rawCalls.map((tc, i) => ({
                  index: typeof tc.index === 'number' ? tc.index : i,
                  id: tc.id,
                  type: 'function' as const,
                  function: tc.function,
                }))
              : undefined,
          });
        }
        return true;
      } catch {
        return false;
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const raw of lines) {
          const line = raw.trimEnd();
          if (!line || line === 'data: [DONE]') {
            partialData = '';
            continue;
          }

          // Lines starting with "data: " carry JSON payload
          if (line.startsWith('data: ')) {
            partialData = line.slice(6); // Replace any partial with the latest data line
          } else if (partialData && !line.startsWith('{') && !line.startsWith('[')) {
            // Continuation of JSON from a previous partial that was split mid-chunk
            partialData += line;
          } else {
            continue;
          }

          if (processChunk(partialData)) partialData = '';
        }
      }

      // Flush any remaining partial data
      if (partialData) processChunk(partialData);
    } finally {
      reader.releaseLock();
    }

    const toolCalls = Array.from(accumulatedToolCalls.values());
    return {
      content: fullContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: reportedUsage,
    };
  }
}
