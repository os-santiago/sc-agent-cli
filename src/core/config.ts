import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProjectConfig } from './types.js';

const CONFIG_DIR = path.join(homedir(), '.sc-agent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: ProjectConfig = {
  model: {
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1', // Ollama default
    model: 'llama3.2',
    temperature: 0.7,
    maxTokens: 4096,
    stream: true,
  },
  permissions: {
    autoApprove: ['read_file', 'list_dir', 'search_text'],
    denyPaths: ['.env', '.env.*', '**/*.key', '**/*.pem'],
  },
  profiles: {
    ollama: {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '<YOUR_OPENAI_KEY>',
      model: 'gpt-4o',
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: '<YOUR_ANTHROPIC_KEY>',
      model: 'claude-sonnet-4-6',
    },
    nvidia: {
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: '<YOUR_NVIDIA_KEY>',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      temperature: 1,
      maxTokens: 16384,
    },
    'llama-3.3-70b': {
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: '<YOUR_NVIDIA_KEY>',
      model: 'meta/llama-3.3-70b-instruct',
      temperature: 0.2,
      maxTokens: 1024,
    },
  },
  activeProfile: 'ollama',
};

const API_KEY_REQUIREMENTS = [
  {
    hostPattern: 'api.openai.com',
    providerName: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
  },
  {
    hostPattern: 'api.anthropic.com',
    providerName: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
  },
  {
    hostPattern: 'integrate.api.nvidia.com',
    providerName: 'NVIDIA',
    envVar: 'NVIDIA_API_KEY',
  },
] as const;

export async function loadConfig(projectRoot?: string): Promise<ProjectConfig> {
  let config = { ...DEFAULT_CONFIG };

  // Load global config
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    config = deepMerge(config, JSON.parse(data));
  } catch (err: unknown) {
    // No global config, use defaults
  }

  // Load project-local config if in a project
  if (projectRoot) {
    const projectConfigPath = path.join(projectRoot, '.sc-agent.json');
    try {
      const data = await readFile(projectConfigPath, 'utf-8');
      config = deepMerge(config, JSON.parse(data));
    } catch (err: unknown) {
      // No project config
    }
  }

  // Apply active profile if set
  if (config.activeProfile && config.profiles?.[config.activeProfile]) {
    const profile = config.profiles[config.activeProfile];
    config.model = { ...config.model, ...profile };
  }

  // Replace placeholder API keys with undefined (for local models)
  if (config.model.apiKey?.startsWith('<YOUR_')) {
    config.model.apiKey = undefined;
  }

  // Override API key from environment variable if available
  // Priority: SC_API_KEY > provider-specific env vars
  const envApiKey = process.env.SC_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.NVIDIA_API_KEY;

  if (envApiKey) {
    config.model.apiKey = envApiKey;
  }

  // Validate required fields
  validateConfig(config);

  return config;
}

export function validateConfig(config: ProjectConfig): void {
  if (!config.model.baseUrl) {
    throw new Error('Missing model.baseUrl in config');
  }

  if (!config.model.model) {
    throw new Error('Missing model.model in config');
  }

  const missingApiKeyRule = API_KEY_REQUIREMENTS.find(
    (rule) => config.model.baseUrl.includes(rule.hostPattern) && !config.model.apiKey
  );

  if (missingApiKeyRule) {
    throw new Error(
      `${missingApiKeyRule.providerName} API requires an API key. ` +
      `Set model.apiKey in config, ${missingApiKeyRule.envVar}, or SC_API_KEY.`
    );
  }
}

export function getGlobalConfigPath(): string {
  return CONFIG_PATH;
}

export async function saveConfig(config: ProjectConfig, global = true): Promise<void> {
  const targetPath = global ? CONFIG_PATH : path.join(process.cwd(), '.sc-agent.json');

  if (global) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }

  await writeFile(targetPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function initConfig(): Promise<void> {
  await saveConfig(DEFAULT_CONFIG, true);
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key in override) {
    const val = override[key];
    if (val !== undefined) {
      if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
        result[key] = deepMerge(
          (result[key] as Record<string, unknown>) || {},
          val as Record<string, unknown>
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = val as T[Extract<keyof T, string>];
      }
    }
  }
  return result;
}
