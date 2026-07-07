import type { Tool, ToolContext } from './tool.js';

export const webFetchTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch content from a URL. Use for reading documentation, API responses, GitHub pages, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to fetch content from',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 15000)',
          },
        },
        required: ['url'],
      },
    },
  },

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const url = args.url as string;
    const timeout = (args.timeout as number) || 15000;

    if (!url) {
      throw new Error('Missing required argument: url');
    }

    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const MAX_REDIRECTS = 10;

    try {
      let currentUrl = url;
      let redirectCount = 0;

      while (redirectCount <= MAX_REDIRECTS) {
        const response = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'sc-agent-cli/1.0',
            'Accept': 'text/html,application/json,text/plain,*/*',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`Redirect ${response.status} with no Location header`);
          }
          redirectCount++;
          currentUrl = new URL(location, currentUrl).href;
          continue;
        }

        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(`Exceeded maximum redirects (${MAX_REDIRECTS})`);
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        if (contentType.includes('application/json')) {
          try {
            const parsed = JSON.parse(text);
            return JSON.stringify(parsed, null, 2);
          } catch {
            return text;
          }
        }

        if (contentType.includes('text/html')) {
          const cleaned = htmlToText(text);
          return cleaned.length > 30000
            ? cleaned.substring(0, 30000) + '\n\n[Truncated at 30000 characters]'
            : cleaned;
        }

        return text.length > 30000
          ? text.substring(0, 30000) + '\n\n[Truncated at 30000 characters]'
          : text;
      }

      throw new Error(`Exceeded maximum redirects (${MAX_REDIRECTS})`);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`, { cause: err });
      }
      if (err instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${err.message}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

function htmlToText(html: string): string {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(h[1-6]|p|div|li|blockquote|tr|th|td)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  • ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return text;
}
