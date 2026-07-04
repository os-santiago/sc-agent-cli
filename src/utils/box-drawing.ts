export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

export function boxHeader(title: string, indent: number = 0): string {
  const tw = getTerminalWidth();
  const pad = ' '.repeat(indent);
  const avail = tw - indent - 2;
  const required = title.length + 4; // "┌─ " + title + " ─" + "┐"
  const dashes = Math.max(2, avail - required + 1);
  return `${pad}┌─ ${title} ${'─'.repeat(dashes)}┐`;
}

export function boxFooter(indent: number = 0): string {
  const tw = getTerminalWidth();
  const pad = ' '.repeat(indent);
  const dashes = Math.max(2, tw - indent - 2);
  return `${pad}└${'─'.repeat(dashes)}┘`;
}
