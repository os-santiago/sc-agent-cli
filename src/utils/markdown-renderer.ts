import chalk from 'chalk';

/**
 * Renders inline markdown patterns to ANSI-formatted text.
 * For streaming chunks - single-pass, no state.
 */
export function renderInline(text: string): string {
  let result = text;

  // Code blocks (```...```) - render whole block with dim background
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    return chalk.cyan(code.replace(/\n$/, ''));
  });

  // Inline code `...`
  result = result.replace(/`([^`]+)`/g, (_, code) => {
    return chalk.inverse(code);
  });

  // Bold **...**
  result = result.replace(/\*\*(.+?)\*\*/g, (_, text) => {
    return chalk.bold(text);
  });

  // Italic *...* (not preceded by word char to avoid matching path/glob patterns)
  result = result.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, (_, text) => {
    return chalk.italic(text);
  });

  // Horizontal rules ---, ***, ___
  result = result.replace(/^(?:[-*_]){3,}$/gm, () => {
    return chalk.dim('─'.repeat(process.stdout.columns - 6 || 60));
  });

  // Headers: ## text
  result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_, _hashes, text) => {
    return chalk.bold.cyan(text);
  });

  // Links [text](url) - render as underlined text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, (_, text) => {
    return chalk.underline(text);
  });

  // Blockquotes > text
  result = result.replace(/^>\s+(.+)$/gm, (_, text) => {
    return chalk.dim('│ ' + text);
  });

  // Unordered list items - * or -
  result = result.replace(/^[\s]*[-*+]\s+(.+)$/gm, (_, text) => {
    return ' • ' + text;
  });

  return result;
}
