import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { MarkedExtension } from 'marked';

marked.use((markedTerminal({
  width: process.stdout.columns || 80,
  showSectionPrefix: false,
  unescape: true,
  emoji: true,
  reflowText: false,
  heading: chalk.bold.cyan,
  firstHeading: chalk.bold.underline.magenta,
  code: chalk.cyan,
  blockquote: chalk.gray.italic,
  hr: chalk.dim,
  listitem: chalk.reset,
  table: chalk.reset,
  paragraph: chalk.reset,
  strong: chalk.bold,
  em: chalk.italic,
  codespan: chalk.yellow,
  del: chalk.dim.gray.strikethrough,
  link: chalk.blue,
  href: chalk.blue.underline,
}) as unknown) as MarkedExtension);

export function renderInline(text: string): string {
  if (!text) return '';
  try {
    return (marked.parse(text, { async: false }) as string).trimEnd();
  } catch {
    return text;
  }
}
