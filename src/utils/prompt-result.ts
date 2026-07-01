export function getPromptBoolean(
  response: Record<string, unknown>,
  key = 'value'
): boolean | null {
  const value = response[key];
  return typeof value === 'boolean' ? value : null;
}

export function getPromptString<T extends string>(
  response: Record<string, unknown>,
  key: string
): T | null {
  const value = response[key];
  return typeof value === 'string' && value.length > 0 ? (value as T) : null;
}
