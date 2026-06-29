// Core types for the agent system

// CRITICAL: 'tool' role is REQUIRED for OpenAI API spec compliance.
// DO NOT REMOVE - breaks response generation. See CRITICAL-FIXES.md
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string; // for tool responses
  name?: string; // for tool responses
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface ModelConfig {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey?: string; // Optional for local models (Ollama, LM Studio)
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export type PermissionProfile = 'traditional' | 'blacklist';

export interface ProjectConfig {
  model: ModelConfig;
  permissions?: {
    autoApprove?: string[]; // glob patterns for auto-approved tools
    denyPaths?: string[]; // paths to never access
    profile?: PermissionProfile; // Permission behavior profile
  };
  profiles?: Record<string, Partial<ModelConfig>>; // Named profiles
  activeProfile?: string;
}

export interface StreamDelta {
  role?: MessageRole;
  content?: string;
  tool_calls?: ToolCallDelta[];
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string; // partial JSON
  };
}
