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
}

export interface ChatCompletionResponse {
  content: string;
  tool_calls?: ToolCall[];
}

export class OpenAICompatibleProvider {
  constructor(private config: ModelConfig) {}

  async chatCompletion(
    options: ChatCompletionOptions,
    onChunk?: (delta: StreamDelta) => void
  ): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
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

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      throw new Error(this.formatNetworkError(url, err));
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(this.formatApiError(response.status, response.statusText, errorText));
    }

    if (options.stream && response.body) {
      return this.handleStreamResponse(response.body, onChunk);
    } else {
      return this.handleNonStreamResponse(response);
    }
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
    let fullContent = '';
    const accumulatedToolCalls: Map<number, ToolCall> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.trim() === 'data: [DONE]') continue;

          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const chunk = JSON.parse(jsonStr);
              const delta = chunk.choices?.[0]?.delta;
              if (!delta) continue;

              // Accumulate content
              if (delta.content) {
                fullContent += delta.content;
              }

              // Accumulate tool calls
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
                    if (tc.function?.name) {
                      existing.function.name += tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      existing.function.arguments += tc.function.arguments;
                    }
                  }
                }
              }

              // Emit delta to callback
              if (onChunk) {
                onChunk({
                  role: delta.role,
                  content: delta.content,
                  tool_calls: delta.tool_calls,
                });
              }
            } catch (err: unknown) {
              // Skip malformed JSON chunks
              console.error('Malformed chunk:', jsonStr, err);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls = Array.from(accumulatedToolCalls.values());
    return {
      content: fullContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private formatNetworkError(url: string, err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return `Network error while reaching ${url}: ${message}`;
  }

  private formatApiError(status: number, statusText: string, errorText: string): string {
    const detail = this.extractErrorDetail(errorText);
    const statusLabel = statusText ? ` ${statusText}` : '';
    return detail
      ? `API Error ${status}${statusLabel}: ${detail}`
      : `API Error ${status}${statusLabel}`;
  }

  private extractErrorDetail(errorText: string): string {
    const normalized = errorText.trim();
    if (!normalized) {
      return '';
    }

    try {
      const parsed = JSON.parse(normalized) as {
        error?: { message?: unknown };
        message?: unknown;
      };

      if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
        return this.truncateErrorDetail(parsed.error.message);
      }

      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return this.truncateErrorDetail(parsed.message);
      }
    } catch {
      // Fall back to raw text when the response is not JSON.
    }

    return this.truncateErrorDetail(normalized.replace(/\s+/g, ' '));
  }

  private truncateErrorDetail(detail: string): string {
    const maxLength = 300;
    const normalized = detail.trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
  }
}
