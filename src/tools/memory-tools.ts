import type { Tool, ToolContext } from './tool.js';
import { persistentMemory } from '../utils/memory.js';
import { requestPermission } from '../utils/permissions.js';

export const memoryReadTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'memory_read',
      description: 'Read from persistent memory (cross-session). Use this to recall user preferences, project context, and information learned in previous sessions.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Specific memory key to recall (exact match)',
          },
          query: {
            type: 'string',
            description: 'Search query to find relevant memories',
          },
        },
      },
    },
  },

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const key = args.key as string | undefined;
    const query = args.query as string | undefined;

    if (!key && !query) {
      return await persistentMemory.getSummary();
    }

    if (key) {
      const result = await persistentMemory.recall(key);
      if (result) {
        return `[Memory: ${key}]\n${result}`;
      }
      return `No memory found with key "${key}". Use memory_write to save information about this topic.`;
    }

    if (query) {
      const results = await persistentMemory.search(query);
      if (results.length === 0) {
        return `No memories found matching "${query}".`;
      }
      return results
        .map(r => `[Memory: ${r.key}]\n${r.content.substring(0, 500)}${r.content.length > 500 ? '...' : ''}`)
        .join('\n\n---\n\n');
    }

    return 'No memory found.';
  },
};

export const memoryWriteTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'memory_write',
      description: 'Save information to persistent memory for future sessions. Use for user preferences, project rules, important facts. This data persists across restarts.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Unique key (e.g., "user-name", "project-config", "coding-preferences")',
          },
          content: {
            type: 'string',
            description: 'Detailed content to remember',
          },
          tags: {
            type: 'string',
            description: 'Comma-separated tags (e.g., "user,preference")',
          },
        },
        required: ['key', 'content'],
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const key = args.key as string;
    const content = args.content as string;
    const tags = (args.tags as string || '').split(',').map(t => t.trim()).filter(Boolean);

    if (!key || !content) {
      throw new Error('Missing required arguments: key, content');
    }

    const approved = await requestPermission({
      toolName: 'memory_write',
      args,
      config: ctx.config,
      autoApprove: ctx.autoApprove,
    });

    if (!approved) {
      throw new Error('Permission denied by user');
    }

    await persistentMemory.remember(key, content, tags);
    return `✓ Saved to memory: "${key}"${tags.length > 0 ? ` [${tags.join(', ')}]` : ''}`;
  },
};
