import type { ProjectConfig } from '../core/types.js';

export interface ResolvedSettings {
  hud: boolean;
  hudFields: string[];
}

const ALL_HUD_FIELDS = ['model', 'profile', 'memories', 'messages', 'storage', 'permissions'];

export function resolveSettings(config: ProjectConfig): ResolvedSettings {
  const configHud = config.settings?.hud;
  const envHud = process.env.SC_HUD;

  const hud = envHud !== undefined
    ? envHud === '1' || envHud.toLowerCase() === 'true'
    : configHud ?? true;

  // HUD fields: validate stored fields against known set; fall back to all
  const storedFields = config.settings?.hudFields;
  const hudFields = storedFields && storedFields.length > 0 && storedFields.every(f => ALL_HUD_FIELDS.includes(f))
    ? storedFields
    : ALL_HUD_FIELDS;

  return { hud, hudFields };
}

export { ALL_HUD_FIELDS };
