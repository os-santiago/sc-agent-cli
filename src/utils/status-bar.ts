import chalk from 'chalk';
import { WriteStream } from 'node:tty';

export class StatusBar {
  private content: string = '';
  private isVisible: boolean = false;
  private stdout: WriteStream;

  constructor() {
    this.stdout = process.stdout as WriteStream;
  }

  show(content: string) {
    this.content = content;
    this.isVisible = true;
    this.render();
  }

  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.clear();
  }

  private render() {
    if (!this.isVisible || !this.stdout.isTTY) return;

    const rows = this.stdout.rows || 24;

    // Save cursor position
    this.stdout.write('\x1b[s');

    // Move to last row, first column
    this.stdout.write(`\x1b[${rows};1H`);

    // Clear the line
    this.stdout.write('\x1b[2K');

    // Write content
    this.stdout.write(this.content);

    // Restore cursor position
    this.stdout.write('\x1b[u');
  }

  private clear() {
    if (!this.stdout.isTTY) return;

    const rows = this.stdout.rows || 24;

    // Save cursor
    this.stdout.write('\x1b[s');

    // Move to last row
    this.stdout.write(`\x1b[${rows};1H`);

    // Clear the line
    this.stdout.write('\x1b[2K');

    // Restore cursor
    this.stdout.write('\x1b[u');
  }

  refresh() {
    if (this.isVisible) {
      this.render();
    }
  }
}

export function getShortcutsBar(): string {
  const shortcuts = [
    chalk.dim('↑↓') + chalk.gray(':history'),
    chalk.dim('Tab') + chalk.gray(':complete'),
    chalk.dim('Ctrl+C') + chalk.gray(':exit'),
    chalk.dim('/help') + chalk.gray(':cmds'),
    chalk.dim('/profile') + chalk.gray(':smart'),
  ].join(chalk.dim(' │ '));

  // Ensure it fits in terminal width
  const maxWidth = (process.stdout.columns || 80) - 4;
  const content = `  ${shortcuts}`;

  return chalk.bgBlack(chalk.gray(content.substring(0, maxWidth)));
}

// Global status bar instance
export const statusBar = new StatusBar();

// Handle terminal resize
process.stdout.on('resize', () => {
  statusBar.refresh();
});
