export type PermissionMode = 'ask_once' | 'always_ask' | 'unlimited';

interface PermissionModeChoice {
  title: string;
  value: PermissionMode;
  description: string;
}

const PERMISSION_MODE_CONFIG: Record<PermissionMode, { title: string; description: string }> = {
  ask_once: {
    title: 'Ask once per command (recommended)',
    description: 'Prompt once per unique tool, then auto-approve for session',
  },
  always_ask: {
    title: 'Always ask (safer)',
    description: 'Prompt every time a tool is used',
  },
  unlimited: {
    title: 'Unlimited (dangerous)',
    description: 'Auto-approve all tools without asking',
  },
};

const PERMISSION_MODE_ORDER: PermissionMode[] = ['ask_once', 'always_ask', 'unlimited'];

export function getPermissionModeChoices(currentMode: PermissionMode): PermissionModeChoice[] {
  return PERMISSION_MODE_ORDER.map((mode) => ({
    title: `${PERMISSION_MODE_CONFIG[mode].title}${mode === currentMode ? ' (current)' : ''}`,
    value: mode,
    description: PERMISSION_MODE_CONFIG[mode].description,
  }));
}

export function getPermissionModeInitial(currentMode: PermissionMode): number {
  return PERMISSION_MODE_ORDER.indexOf(currentMode);
}
