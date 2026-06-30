import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProjectConfig, ModelConfig } from './types.js';

function getConfigDir(): string {
  return path.join(homedir(), '.sc-agent');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

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
  let config = { ...DEFAULT_CONFIG };

  // Load global config
  try {
    const data = await readFile(getConfigPath(), 'utf-8');
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
  return getConfigPath();
}

export async function saveConfig(config: ProjectConfig, global = true): Promise<void> {
  const targetPath = global ? getConfigPath() : path.join(process.cwd(), '.sc-agent.json');

  if (global) {
    await mkdir(getConfigDir(), { recursive: true });
  }

  await writeFile(targetPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function initConfig(force = false): Promise<void> {
  const configPath = getConfigPath();

  if (!force && await fileExists(configPath)) {
    throw new Error(
      `Global config already exists at ${configPath}. ` +
      'Re-run "sc config-init --force" to overwrite it.'
    );
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
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (err: unknown) {
    if (isMissingFileError(err)) {
      return false;
    }

    throw new Error(
      `Could not access config path at ${filePath}. ` +
      'Check file permissions and try again.'
    );
  }
}

function isMissingFileError(err: unknown): err is NodeJS.ErrnoException {
  if (!err || typeof err !== 'object') {
    return false;
  }

  return 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
