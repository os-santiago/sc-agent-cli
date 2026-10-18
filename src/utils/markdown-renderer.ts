import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { MarkedExtension } from 'marked';

const terminalExtension = markedTerminal({
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
}) as unknown as MarkedExtension;

// marked >=17 emits a dedicated `checkbox` token inside task list items while
// marked-terminal also prepends the checkbox inside `listitem`, which would
// render "- [x]" twice. Neutralize the token renderer so a single checkbox is
// produced on every supported marked version (<17 never emits the token).
if (terminalExtension.renderer) {
  terminalExtension.renderer.checkbox = () => '';
}

marked.use(terminalExtension);

export function renderInline(text: string): string {
  if (!text) return '';
  try {
    return (marked.parse(text, { async: false }) as string).trimEnd();
  } catch {
    return text;
  }
}
