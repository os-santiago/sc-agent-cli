import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
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

function formatMissingFieldError(field: 'model.baseUrl' | 'model.model'): Error {
  return new Error(
    [
      `Missing required config field: ${field}.`,
      `Run "sc config-init" to create a default config, or update ${CONFIG_PATH} manually.`,
    ].join(' ')
  );
}

function getProviderApiKeyEnvVar(baseUrl: string): string | undefined {
  if (baseUrl.includes('api.openai.com')) {
    return 'OPENAI_API_KEY';
  }

  if (baseUrl.includes('api.anthropic.com')) {
    return 'ANTHROPIC_API_KEY';
  }

  if (baseUrl.includes('integrate.api.nvidia.com')) {
    return 'NVIDIA_API_KEY';
  }

  return undefined;
}

function formatMissingApiKeyError(config: ProjectConfig): Error {
  const providerName = config.activeProfile || config.model.baseUrl;
  const envVar = getProviderApiKeyEnvVar(config.model.baseUrl);
  const envVarGuidance = envVar
    ? `Set ${envVar} (or SC_API_KEY),`
    : 'Set SC_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or NVIDIA_API_KEY,';

  return new Error(
    [
      `Missing API key for "${providerName}".`,
      envVarGuidance,
      `or add model.apiKey to ${CONFIG_PATH}.`,
    ].join(' ')
  );
}

function validateConfig(config: ProjectConfig): void {
  if (!config.model.baseUrl) {
    throw formatMissingFieldError('model.baseUrl');
  }

  if (!config.model.model) {
    throw formatMissingFieldError('model.model');
  }

  if (getProviderApiKeyEnvVar(config.model.baseUrl) && !config.model.apiKey) {
    throw formatMissingApiKeyError(config);
  }
}

export async function loadConfig(projectRoot?: string): Promise<ProjectConfig> {
  let config = { ...DEFAULT_CONFIG };

  // Load global config
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    config = deepMerge(config, JSON.parse(data));
  } catch (err: unknown) {
    // No global config, use defaults
     
    const _err = err;
  }

  // Load project-local config if in a project
  if (projectRoot) {
    const projectConfigPath = path.join(projectRoot, '.sc-agent.json');
    try {
      const data = await readFile(projectConfigPath, 'utf-8');
      config = deepMerge(config, JSON.parse(data));
    } catch (err: unknown) {
      // No project config
       
      const _err = err;
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

  validateConfig(config);

  return config;
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

export async function initConfig(force = false): Promise<void> {
  if (!force) {
    try {
      await access(CONFIG_PATH);
      throw new Error(
        `Config already exists at ${CONFIG_PATH}. Use "sc config-init --force" to overwrite it.`
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Config already exists at ')) {
        throw err;
      }
    }
  }

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
