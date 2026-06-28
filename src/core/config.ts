import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProjectConfig, ModelConfig } from './types.js';

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

export async function loadConfig(projectRoot?: string): Promise<ProjectConfig> {
  let config: ProjectConfig = { ...DEFAULT_CONFIG };

  // Load global config
  const globalConfig = await loadConfigFile(CONFIG_PATH, 'global');
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
  }

  // Load project-local config if in a project
  if (projectRoot) {
    const projectConfigPath = path.join(projectRoot, '.sc-agent.json');
    const projectConfig = await loadConfigFile(projectConfigPath, 'project');
    if (projectConfig) {
      config = deepMerge(config, projectConfig);
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
  if (!config.model.baseUrl) {
    throw new Error('Missing model.baseUrl in config');
  }
  if (!config.model.model) {
    throw new Error('Missing model.model in config');
  }
  if (config.model.baseUrl.includes('api.openai.com') && !config.model.apiKey) {
    throw new Error('OpenAI API requires apiKey in config');
  }

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

export async function initConfig(): Promise<void> {
  await saveConfig(DEFAULT_CONFIG, true);
}

export async function loadConfigFile(
  filePath: string,
  scope: 'global' | 'project'
): Promise<Partial<ProjectConfig> | null> {
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as Partial<ProjectConfig>;
  } catch (err: unknown) {
    if (isMissingFileError(err)) {
      return null;
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid ${scope} config at ${filePath}: ${errorMsg}`);
    }

    throw new Error(`Failed to load ${scope} config at ${filePath}: ${errorMsg}`);
  }
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base } as T;
  for (const key in override) {
    const val = override[key];
    if (val !== undefined) {
      if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
        const current = result[key] as object | undefined;
        result[key] = deepMerge(
          current ?? {},
          val as object
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = val as T[Extract<keyof T, string>];
      }
    }
  }
  return result;
}

function isMissingFileError(err: unknown): boolean {
  return typeof err === 'object'
    && err !== null
    && 'code' in err
    && err.code === 'ENOENT';
}
