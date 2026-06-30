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
      throw new Error(formatNetworkError(url, err));
    }

    if (!response.ok) {
      throw new Error(await formatApiError(response, url));
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
}

async function formatApiError(response: Response, url: string): Promise<string> {
  const errorBody = await response.text();
  const details = extractErrorDetails(errorBody);

  switch (response.status) {
    case 401:
      return `Authentication failed (${response.status}) for ${url}. Check your API key in config or environment variables.${details ? ` Provider message: ${details}` : ''}`;
    case 404:
      return `Provider endpoint not found (${response.status}) at ${url}. Verify the base URL and make sure it includes the correct API path such as /v1.${details ? ` Provider message: ${details}` : ''}`;
    case 429:
      return `Provider rate limit reached (${response.status}) for ${url}. Retry later or lower request volume.${details ? ` Provider message: ${details}` : ''}`;
    default:
      return `API error ${response.status} from ${url}.${details ? ` Provider message: ${details}` : ''}`;
  }
}

function extractErrorDetails(errorBody: string): string {
  const trimmed = errorBody.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (parsed.error && typeof parsed.error === 'object' && parsed.error.message?.trim()) {
      return parsed.error.message.trim();
    }
    if (parsed.message?.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // Fall back to the raw body for non-JSON provider errors.
  }

  return trimmed;
}

function formatNetworkError(url: string, err: unknown): string {
  const details = err instanceof Error ? err.message : String(err);
  return `Could not reach provider at ${url}. Check that the base URL is correct, the provider is running, and your network connection is available. Original error: ${details}`;
}
