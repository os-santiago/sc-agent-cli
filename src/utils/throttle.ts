import type { ThrottleConfig } from '../core/types.js';

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const PROVIDER_THROTTLE_DEFAULTS: Record<string, Partial<ThrottleConfig>> = {
  anthropic: { minDelayMs: 0, afterEmptyResponse: 2000, afterError: 5000 },
  openai: { minDelayMs: 1000, afterEmptyResponse: 3000, afterError: 8000 },
  nvidia: { minDelayMs: 3000, afterEmptyResponse: 5000, afterError: 10000 },
  ollama: { minDelayMs: 0, afterEmptyResponse: 1000, afterError: 2000 },
  groq: { minDelayMs: 2000, afterEmptyResponse: 4000, afterError: 10000 },
  together: { minDelayMs: 1000, afterEmptyResponse: 3000, afterError: 8000 },
  lmstudio: { minDelayMs: 0, afterEmptyResponse: 0, afterError: 1000 },
};

function detectProvider(modelName: string, baseUrl: string): string {
  const url = baseUrl.toLowerCase();
  if (url.includes('anthropic')) return 'anthropic';
  if (url.includes('openai') || url.includes('api.openai')) return 'openai';
  if (url.includes('nvidia') || url.includes('api.nvcf')) return 'nvidia';
  if (url.includes('ollama') || url.includes('localhost:11434')) return 'ollama';
  if (url.includes('groq')) return 'groq';
  if (url.includes('together')) return 'together';
  if (url.includes('lmstudio') || url.includes('localhost:1234')) return 'lmstudio';
  return 'openai';
}

const DEFAULT_THROTTLE: ThrottleConfig = {
  enabled: false,
  minDelayMs: 1000,
  afterEmptyResponse: 3000,
  afterError: 8000,
  maxDelayMs: 30000,
  mode: 'exponential',
};

export function resolveThrottleConfig(
  config: Partial<ThrottleConfig> | undefined,
  modelName: string,
  baseUrl: string
): ThrottleConfig {
  const provider = detectProvider(modelName, baseUrl);
  const providerDefaults = PROVIDER_THROTTLE_DEFAULTS[provider] || {};

  if (config?.enabled === true) {
    return {
      ...DEFAULT_THROTTLE,
      ...providerDefaults,
      ...config,
    };
  }

  return { ...DEFAULT_THROTTLE, enabled: false };
}

export function calculateDelay(
  throttle: ThrottleConfig,
  lastCallTime: number,
  consecutiveEmpty: number,
  lastError: boolean
): number {
  if (!throttle.enabled) return 0;

  const elapsed = Date.now() - lastCallTime;
  let delay = throttle.minDelayMs - elapsed;

  if (delay < 0) delay = 0;

  if (consecutiveEmpty > 0 && throttle.mode === 'exponential') {
    const backoff = Math.min(
      throttle.minDelayMs * Math.pow(2, consecutiveEmpty),
      throttle.maxDelayMs
    );
    delay = Math.max(delay, backoff);
  }

  if (consecutiveEmpty > 0) {
    delay = Math.max(delay, throttle.afterEmptyResponse);
  }

  if (lastError) {
    delay = Math.max(delay, throttle.afterError);
  }

  return delay;
}
