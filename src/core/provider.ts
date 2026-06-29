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
      throw new Error(this.formatRequestError(err, url));
    }

    if (!response.ok) {
      throw new Error(await this.formatApiError(response));
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

  private async formatApiError(response: Response): Promise<string> {
    const details = await this.readErrorDetails(response);
    const reason = `${response.status} ${response.statusText}`.trim();
    const normalizedDetails = details ? details.replace(/[.\s]+$/, '') : undefined;
    const message = normalizedDetails
      ? `API request failed (${reason}): ${normalizedDetails}.`
      : `API request failed (${reason}).`;
    const guidance = this.getStatusGuidance(response.status);

    return guidance ? `${message} ${guidance}` : message;
  }

  private async readErrorDetails(response: Response): Promise<string | undefined> {
    const rawText = (await response.text()).trim();
    if (!rawText) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(rawText) as {
        error?: { message?: string };
        message?: string;
      };

      return parsed.error?.message || parsed.message || rawText;
    } catch {
      return rawText;
    }
  }

  private formatRequestError(err: unknown, url: string): string {
    const base = err instanceof Error && err.message ? err.message : 'Unknown network error';

    if (err instanceof TypeError) {
      return `Could not reach model endpoint at ${url}: ${base}. Check the base URL, provider availability, and network connection.`;
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      return `Request to ${url} timed out or was aborted. Retry the command and verify the provider is responsive.`;
    }

    return `Request to ${url} failed: ${base}`;
  }

  private getStatusGuidance(status: number): string | undefined {
    switch (status) {
      case 400:
        return 'Check the request parameters and confirm the selected model supports the requested tool or message format.';
      case 401:
        return 'Verify the API key for the active profile or set SC_API_KEY before retrying.';
      case 403:
        return 'Check whether the active API key has permission to use this model or endpoint.';
      case 404:
        return 'Confirm the base URL and model name are correct for this provider.';
      case 429:
        return 'You may be rate limited. Wait briefly, reduce request frequency, or switch to another model/profile.';
      default:
        if (status >= 500) {
          return 'The provider reported a server-side error. Retry shortly or switch providers if the issue persists.';
        }
        return undefined;
    }
  }
}
