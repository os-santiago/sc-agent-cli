import chalk from 'chalk';

export type VerboseLevel = 0 | 1 | 2 | 3;

let _level: VerboseLevel = 0;

export function setVerboseLevel(level: VerboseLevel): void {
  _level = level;
}

export function getVerboseLevel(): VerboseLevel {
  return _level;
}

export function isVerbose(minLevel: VerboseLevel = 1): boolean {
  return _level >= minLevel;
}

function timestamp(): string {
  return new Date().toISOString().split('T')[1]?.replace('Z', '') || '';
}

export function verbose(msg: string, level: VerboseLevel = 1): void {
  if (_level >= level) {
    process.stderr.write(chalk.gray(`[${timestamp()}] ${msg}\n`));
  }
}

export function verboseApi(msg: string, level: VerboseLevel = 2): void {
  if (_level >= level) {
    process.stderr.write(chalk.cyan(`[${timestamp()}] ${msg}\n`));
  }
}

export function verboseError(msg: string): void {
  if (_level >= 1) {
    process.stderr.write(chalk.red(`[${timestamp()}] ERROR: ${msg}\n`));
  }
}

export function verboseTool(name: string, args: Record<string, unknown>, result: string, duration: number, level: VerboseLevel = 1): void {
  if (_level >= level) {
    const argStr = JSON.stringify(args).substring(0, 200);
    const resultLen = result.length;
    process.stderr.write(chalk.magenta(`[${timestamp()}] TOOL: ${name}(${argStr}) → ${resultLen} chars in ${duration}ms\n`));
  }
}

export function verboseApiRequest(url: string, body: Record<string, unknown>, level: VerboseLevel = 2): void {
  if (_level >= level) {
    const sanitized = JSON.parse(JSON.stringify(body));
    if (sanitized.messages && Array.isArray(sanitized.messages)) {
      sanitized.messages = sanitized.messages.map((m: Record<string, unknown>) => ({
        role: m.role,
        content: typeof m.content === 'string' ? `${(m.content as string).substring(0, 100)}... (${(m.content as string).length} chars)` : m.content,
        tool_calls: m.tool_calls ? `${(m.tool_calls as unknown[]).length} tool calls` : undefined,
      }));
    }
    process.stderr.write(chalk.cyan(`[${timestamp()}] API Request: POST ${url}\n`));
    process.stderr.write(chalk.cyan(`[${timestamp()}] API Body: ${JSON.stringify(sanitized, null, 2).substring(0, 500)}\n`));
  }
}

export function verboseApiResponse(status: number, duration: number, level: VerboseLevel = 2): void {
  if (_level >= level) {
    const color = status < 400 ? chalk.green : chalk.red;
    process.stderr.write(color(`[${timestamp()}] API Response: ${status} in ${duration}ms\n`));
  }
}

export function verboseToolCall(toolName: string, args: Record<string, unknown>, level: VerboseLevel = 1): void {
  if (_level >= level) {
    const argStr = JSON.stringify(args).substring(0, 300);
    process.stderr.write(chalk.magenta(`[${timestamp()}] TOOL CALL: ${toolName}(${argStr})\n`));
  }
}

export function verboseSession(sessionId: string, messageCount: number, level: VerboseLevel = 1): void {
  if (_level >= level) {
    process.stderr.write(chalk.green(`[${timestamp()}] SESSION: ${sessionId} — ${messageCount} messages\n`));
  }
}
