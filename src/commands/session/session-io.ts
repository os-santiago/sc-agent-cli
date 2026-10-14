import chalk from 'chalk';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { writeFileSecureSync } from '../../utils/secure-fs.js';
import { redactDeep } from '../../utils/secret-redaction.js';
import { persistSessionHistory } from './history.js';
import type { SessionContext, SlashCommandHandler } from './types.js';

async function exportSession(ctx: SessionContext, exportPath: string): Promise<void> {
  try {
    const exportDir = dirname(exportPath);
    if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: ctx.options.workspaceRoot,
      model: ctx.currentConfig.model.model,
      provider: ctx.currentConfig.model.baseUrl,
      profile: ctx.currentConfig.activeProfile || 'default',
      history: redactDeep(ctx.history),
      inputHistory: redactDeep(ctx.inputHistory),
    };
    writeFileSecureSync(exportPath, JSON.stringify(payload, null, 2));
    console.log(chalk.green(`\n✓ Session exported to ${exportPath} (${ctx.history.length} messages)\n`));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Export failed: ${errorMsg}\n`));
  }
}

async function importSession(ctx: SessionContext, importPath: string | undefined): Promise<void> {
  if (!importPath) {
    console.log(chalk.yellow('\n⚠ Usage: /session import <path-to-session.json>\n'));
    return;
  }
  try {
    if (!existsSync(importPath)) {
      console.log(chalk.yellow(`\n⚠ File not found: ${importPath}\n`));
      return;
    }
    const data = JSON.parse(readFileSync(importPath, 'utf-8'));
    if (!data.version || !Array.isArray(data.history)) {
      console.log(chalk.yellow('\n⚠ Invalid session file format\n'));
      return;
    }
    ctx.historyCheckpoints.push(JSON.parse(JSON.stringify(ctx.history))); // Save checkpoint before importing
    ctx.history = data.history;
    ctx.inputHistory = data.inputHistory || [];
    // Persist imported history
    persistSessionHistory(ctx, '\n  ⚠️  Warning: Could not persist history to disk\n');
    const importedFrom = data.model ? ` (model: ${data.model})` : '';
    console.log(chalk.green(`\n✓ Session imported${importedFrom} — ${ctx.history.length} messages restored\n`));
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n✗ Import failed: ${errorMsg}\n`));
  }
}

function printSessionInfo(ctx: SessionContext): void {
  const info = {
    messages: ctx.history.length,
    inputHistory: ctx.inputHistory.length,
    workspace: ctx.options.workspaceRoot,
    model: ctx.currentConfig.model.model,
    provider: ctx.currentConfig.model.baseUrl,
    profile: ctx.currentConfig.activeProfile || 'default',
  };
  console.log(chalk.cyan('\n📦 Session Info'));
  console.log(chalk.gray(`  Messages:     ${info.messages}`));
  console.log(chalk.gray(`  Input saved:  ${info.inputHistory}`));
  console.log(chalk.gray(`  Workspace:    ${info.workspace}`));
  console.log(chalk.gray(`  Model:        ${info.model}`));
  console.log(chalk.gray(`  Provider:     ${info.provider}`));
  console.log(chalk.gray(`  Profile:      ${info.profile}`));
  console.log(chalk.gray(`  Usage:        /session export [path]`));
  console.log(chalk.gray(`                /session import <path>\n`));
}

/** `/session export|import|info` — portable session snapshots. */
export const handleSession: SlashCommandHandler = async (ctx, input) => {
  if (!input.toLowerCase().startsWith('/session')) return false;
  const sessionArgs = input.trim().split(/\s+/);
  const sessionSub = sessionArgs[1]?.toLowerCase();

  if (sessionSub === 'export') {
    const exportPath = sessionArgs[2] || join(process.cwd(), `session-${Date.now()}.json`);
    await exportSession(ctx, exportPath);
  } else if (sessionSub === 'import') {
    await importSession(ctx, sessionArgs[2]);
  } else if (sessionSub === 'info') {
    printSessionInfo(ctx);
  } else {
    console.log(chalk.cyan('\n📦 Session Commands'));
    console.log(chalk.gray('  /session export [path]   - Export session to file'));
    console.log(chalk.gray('  /session import <path>   - Import session from file'));
    console.log(chalk.gray('  /session info            - Show session details\n'));
  }
  return true;
};
