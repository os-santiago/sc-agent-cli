export type PermissionMode = 'ask_once' | 'always_ask' | 'unlimited';

export function shouldAutoApproveForPermissionMode(mode: PermissionMode): boolean {
  return mode === 'unlimited';
}
