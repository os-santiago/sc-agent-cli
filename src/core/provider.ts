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
      throw new Error(await this.formatApiError(url, response));
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

  private async formatApiError(url: string, response: Response): Promise<string> {
    const errorText = await response.text();
    const detail = extractErrorDetail(errorText);
    const endpoint = safeFormatUrl(url);

    const messageParts = [`API request failed (${response.status} ${response.statusText})`];

    if (detail) {
      messageParts.push(detail);
    }

    if (response.status === 401 || response.status === 403) {
      messageParts.push('Check that your API key is set correctly for this provider.');
    } else if (response.status === 404) {
      messageParts.push(`Check that the provider base URL is correct: ${endpoint}`);
    } else if (response.status >= 500) {
      messageParts.push('The provider reported a server-side error. Try again in a moment.');
    }

    return messageParts.join('. ');
  }

  private formatNetworkError(url: string, err: unknown): string {
    const endpoint = safeFormatUrl(url);
    const reason = err instanceof Error && err.message ? err.message : 'Unknown network error';

    return (
      `Could not reach the model provider at ${endpoint}. ` +
      `Check that the server is running, the base URL is correct, and your network allows the connection. ` +
      `Original error: ${reason}`
    );
  }
}

function extractErrorDetail(errorText: string): string {
  const trimmed = errorText.trim();
  if (!trimmed) {
    return 'The provider returned no additional error details';
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const extracted = findErrorMessage(parsed);
    if (extracted) {
      return extracted;
    }
  } catch {
    // Fall back to plain text below.
  }

  return truncateErrorText(trimmed);
}

function findErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findErrorMessage(item);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;

  const directMessage = record.message;
  if (typeof directMessage === 'string' && directMessage.trim()) {
    return directMessage.trim();
  }

  const errorField = record.error;
  if (typeof errorField === 'string' && errorField.trim()) {
    return errorField.trim();
  }

  if (errorField && typeof errorField === 'object') {
    const nested = findErrorMessage(errorField);
    if (nested) {
      return nested;
    }
  }

  const errorsField = record.errors;
  if (Array.isArray(errorsField)) {
    for (const item of errorsField) {
      const nested = findErrorMessage(item);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function truncateErrorText(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function safeFormatUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value;
  }
}
