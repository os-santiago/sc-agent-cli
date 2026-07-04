import type { ProjectConfig } from '../core/types.js';

export interface ResolvedSettings {
  hud: boolean;
}

export function resolveSettings(config: ProjectConfig): ResolvedSettings {
  // 1. Config file setting (lowest priority)
  const configHud = config.settings?.hud;

  // 2. Environment variable override (highest priority)
  const envHud = process.env.SC_HUD;

  // Priority: env var > config file > default
  const hud = envHud !== undefined
    ? envHud === '1' || envHud.toLowerCase() === 'true'
    : configHud ?? true;

  return { hud };
}
