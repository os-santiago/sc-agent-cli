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
      throw new Error(formatNetworkError(err, url, this.config.baseUrl));
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
  const detail = extractErrorDetail(await response.text());
  const location = `Request to ${url} failed with ${response.status} ${response.statusText}.`;

  switch (response.status) {
    case 400:
      return joinMessageParts([
        location,
        'The provider rejected the request payload.',
        detail,
      ]);
    case 401:
      return joinMessageParts([
        location,
        'Authentication failed. Check model.apiKey or the provider-specific API key environment variable.',
        detail,
      ]);
    case 403:
      return joinMessageParts([
        location,
        'The provider denied access. Check account permissions and model availability.',
        detail,
      ]);
    case 404:
      return joinMessageParts([
        location,
        'Endpoint not found. Check model.baseUrl and verify the provider supports the OpenAI-compatible /chat/completions route.',
        detail,
      ]);
    case 429:
      return joinMessageParts([
        location,
        'Rate limit reached. Wait and retry, or reduce request frequency.',
        detail,
      ]);
    default:
      if (response.status >= 500) {
        return joinMessageParts([
          location,
          'The provider reported a server-side failure. Retry shortly or check provider status.',
          detail,
        ]);
      }

      return joinMessageParts([
        location,
        'The provider returned an unexpected error response.',
        detail,
      ]);
  }
}

function formatNetworkError(err: unknown, url: string, baseUrl: string): string {
  const code = getErrorCode(err);
  const detail = getErrorMessage(err);
  const location = `Could not reach ${url}.`;
  const localHint = isLocalProvider(baseUrl)
    ? 'Verify the local provider is running and model.baseUrl is correct.'
    : 'Check model.baseUrl, network connectivity, and provider availability.';

  switch (code) {
    case 'ECONNREFUSED':
      return joinMessageParts([
        location,
        'Connection was refused by the provider.',
        localHint,
        detail,
      ]);
    case 'ENOTFOUND':
      return joinMessageParts([
        location,
        'The provider host could not be resolved.',
        'Check model.baseUrl for typos or DNS issues.',
        detail,
      ]);
    case 'ETIMEDOUT':
      return joinMessageParts([
        location,
        'The connection timed out.',
        localHint,
        detail,
      ]);
    default:
      return joinMessageParts([
        location,
        'Network request failed before the provider returned a response.',
        localHint,
        detail,
      ]);
  }
}

function extractErrorDetail(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string };
      message?: string;
    };
    const message = parsed.error?.message || parsed.message;
    if (message) {
      return sanitizeDetail(message);
    }
  } catch {
    // Ignore JSON parse errors and fall back to raw text.
  }

  return sanitizeDetail(trimmed);
}

function sanitizeDetail(detail: string): string {
  const singleLine = detail.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 220) {
    return `Provider response: ${singleLine}`;
  }

  return `Provider response: ${singleLine.slice(0, 217)}...`;
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }

  const code = 'code' in err ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string') {
    return code;
  }

  const cause = 'cause' in err ? (err as { cause?: unknown }).cause : undefined;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const causeCode = (cause as { code?: unknown }).code;
    return typeof causeCode === 'string' ? causeCode : undefined;
  }

  return undefined;
}

function getErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof Error) || !err.message.trim()) {
    return undefined;
  }

  return `Details: ${sanitizeRawMessage(err.message)}`;
}

function sanitizeRawMessage(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim();
  return singleLine.length <= 220 ? singleLine : `${singleLine.slice(0, 217)}...`;
}

function isLocalProvider(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(baseUrl);
}

function joinMessageParts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
