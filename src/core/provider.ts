import type {
  Message,
  ModelConfig,
  ToolDefinition,
  StreamDelta,
  ToolCallDelta,
  ToolCall,
} from './types.js';

export interface ChatCompletionOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ChatCompletionResponse {
  content: string;
  tool_calls?: ToolCall[];
}

const RETRY_DELAYS = [1000, 2000]; // ms between retry attempts
const MAX_RETRIES = 2;
const CONNECTION_TIMEOUT = 60000; // 60s default

export class OpenAICompatibleProvider {
  constructor(private config: ModelConfig) {}

  async chatCompletion(
    options: ChatCompletionOptions,
    onChunk?: (delta: StreamDelta) => void
  ): Promise<ChatCompletionResponse> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const body = {
      model: this.config.model,
      messages: options.messages,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
      stream: options.stream ?? this.config.stream ?? true,
      tools: options.tools,
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const abortController = new AbortController();
      const timeoutTimer = setTimeout(() => abortController.abort(new Error('Connection timed out')), CONNECTION_TIMEOUT);
      let onAbort: (() => void) | null = null;

      try {
        if (options.signal) {
          if (options.signal.aborted) {
            clearTimeout(timeoutTimer);
            throw options.signal.reason || new Error('Aborted');
          }
          onAbort = () => {
            clearTimeout(timeoutTimer);
            abortController.abort(options.signal!.reason || new Error('Aborted'));
          };
          options.signal.addEventListener('abort', onAbort, { once: true });
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        clearTimeout(timeoutTimer);
        if (onAbort && options.signal) options.signal.removeEventListener('abort', onAbort);

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 || response.status >= 500) {
            lastError = new Error(`API Error ${response.status}: ${errorText}`);
            if (attempt < MAX_RETRIES) {
              await this.delay(RETRY_DELAYS[attempt]);
              continue;
            }
          }
          throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        if (options.stream && response.body) {
          return this.handleStreamResponse(response.body, onChunk);
        } else {
          return this.handleNonStreamResponse(response);
        }
      } catch (err: unknown) {
        clearTimeout(timeoutTimer);
        if (onAbort && options.signal) options.signal.removeEventListener('abort', onAbort);

        if (err instanceof Error) {
          if (options.signal?.aborted) throw err;
          if (attempt >= MAX_RETRIES || this.isNonRetryable(err)) throw err;
          lastError = err;
          await this.delay(RETRY_DELAYS[attempt]);
        } else {
          throw err;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  private isNonRetryable(err: Error): boolean {
    const msg = err.message.toLowerCase();
    // 4xx errors (except 429) are client errors — no retry
    if (/4\d\d/.test(msg) && !msg.includes('429')) return true;
    // Auth errors
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) return true;
    // Invalid request
    if (msg.includes('400') || msg.includes('invalid')) return true;
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async handleNonStreamResponse(response: Response): Promise<ChatCompletionResponse> {
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No choices in response');
    }

    return {
      content: choice.message?.content || '',
      tool_calls: choice.message?.tool_calls,
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

    function processChunk(data: string): boolean {
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return true;

        if (delta.content) fullContent += delta.content;

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls as ToolCallDelta[]) {
            const existing = accumulatedToolCalls.get(tc.index);
            if (!existing) {
              accumulatedToolCalls.set(tc.index, {
                id: tc.id || '',
                type: 'function',
                function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
              });
            } else {
              if (tc.function?.name) existing.function.name += tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            }
          }
        }

        if (onChunk) onChunk({ role: delta.role, content: delta.content, tool_calls: delta.tool_calls });
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
    };
  }
}
