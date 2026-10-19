import chalk from 'chalk';
import { stdin as input } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { createCompleter } from '../../utils/autocomplete.js';

const ESC = String.fromCharCode(0x1b);

// Multi-line input handler: Enter=submit, Shift+Enter=newline, paste inserts verbatim
export function readUserInput(history: string[], workspaceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if stdin is a TTY - if not, use simple line reading
    if (!input.isTTY) {
      // Non-TTY mode: read entire input from stdin (batch mode)
      let inputData = '';
      let settled = false;
      input.setEncoding('utf8');
      const onData = (chunk: string) => { inputData += chunk; };
      const onEnd = () => {
        if (!settled) { settled = true; }
        cleanup();
        resolve(inputData.trim());
      };
      const onError = (err: Error) => {
        if (!settled) { settled = true; }
        cleanup();
        reject(err);
      };
      function cleanup() {
        input.removeListener('data', onData);
        input.removeListener('end', onEnd);
        input.removeListener('error', onError);
      }
      input.on('data', onData);
      input.on('end', onEnd);
      input.on('error', onError);
      // If stdin is already ended (piped input), resolve immediately
      if (input.readableEnded) {
        cleanup();
        resolve('');
      }
      return;
    }

    // TTY mode: interactive multi-line editor
    const buf: string[] = [''];
    let cursorLine = 0;
    let cursorCol = 0;
    let historyIdx = history.length;
    let historyBuf = '';

    let prevPhysicalRows = 0;

    function renderInput(): void {
      const tw = process.stdout.columns || 80;
      const prefix = chalk.bold.blue('│ ');
      // Move up and clear previous lines
      for (let i = 0; i < prevPhysicalRows; i++) {
        process.stdout.write(`${ESC}[1A${ESC}[2K\r`);
      }
      let totalPhysicalRows = 0;
      // Write current content
      for (let i = 0; i < buf.length; i++) {
        const line = buf[i]!;
        const display = i === cursorLine
          ? line.slice(0, cursorCol) + (line[cursorCol] ? chalk.inverse(line[cursorCol]) + line.slice(cursorCol + 1) : chalk.inverse(' '))
          : line;
        process.stdout.write(prefix + display);
        if (tw > 0) {
          const padding = Math.max(0, tw - prefix.length - display.length - 2);
          if (padding > 0) process.stdout.write(' '.repeat(padding));
        }
        process.stdout.write('\n');

        // Calculate the physical rows this line occupies on the screen
        const visualLength = 2 + (i === cursorLine ? Math.max(line.length, cursorCol + 1) : line.length);
        const rows = Math.max(1, Math.ceil(visualLength / tw));
        totalPhysicalRows += rows;
      }
      prevPhysicalRows = totalPhysicalRows;
    }

    function getFullInput(): string {
      return buf.join('\n');
    }

    function setFullInput(text: string): void {
      buf.length = 0;
      const lines = text.split('\n');
      for (const l of lines) buf.push(l);
      cursorLine = buf.length - 1;
      cursorCol = buf[cursorLine]!.length;
    }

    function submit(): void {
      if (input.isTTY && input.setRawMode) {
        input.setRawMode(false);
      }
      input.removeAllListeners('keypress');
      // Erase the input area
      for (let i = 0; i < prevPhysicalRows; i++) {
        process.stdout.write(`${ESC}[1A${ESC}[2K\r`);
      }
      resolve(getFullInput());
    }

    function insertChar(ch: string): void {
      const line = buf[cursorLine]!;
      buf[cursorLine] = line.slice(0, cursorCol) + ch + line.slice(cursorCol);
      cursorCol += ch.length;
      renderInput();
    }

    function newline(): void {
      const line = buf[cursorLine]!;
      const rest = line.slice(cursorCol);
      buf[cursorLine] = line.slice(0, cursorCol);
      cursorLine++;
      cursorCol = 0;
      buf.splice(cursorLine, 0, rest);
      renderInput();
    }

    function cursorLeft(): void {
      if (cursorCol > 0) {
        cursorCol--;
        renderInput();
      } else if (cursorLine > 0) {
        cursorLine--;
        cursorCol = buf[cursorLine]!.length;
        renderInput();
      }
    }

    function cursorRight(): void {
      const line = buf[cursorLine]!;
      if (cursorCol < line.length) {
        cursorCol++;
        renderInput();
      } else if (cursorLine < buf.length - 1) {
        cursorLine++;
        cursorCol = 0;
        renderInput();
      }
    }

    function cursorUp(): void {
      if (cursorLine > 0) {
        cursorLine--;
        cursorCol = Math.min(cursorCol, buf[cursorLine]!.length);
        renderInput();
      } else if (historyIdx > 0) {
        if (historyIdx === history.length) historyBuf = getFullInput();
        historyIdx--;
        setFullInput(history[historyIdx]!);
        renderInput();
      }
    }

    function cursorDown(): void {
      if (cursorLine < buf.length - 1) {
        cursorLine++;
        cursorCol = Math.min(cursorCol, buf[cursorLine]!.length);
        renderInput();
      } else if (historyIdx < history.length) {
        historyIdx++;
        if (historyIdx === history.length) {
          setFullInput(historyBuf);
        } else {
          setFullInput(history[historyIdx]!);
        }
        renderInput();
      }
    }

    function backspace(): void {
      if (cursorCol > 0) {
        const line = buf[cursorLine]!;
        buf[cursorLine] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
        cursorCol--;
        renderInput();
      } else if (cursorLine > 0) {
        const prevLine = buf[cursorLine - 1]!;
        const curLine = buf[cursorLine]!;
        buf[cursorLine - 1] = prevLine + curLine;
        buf.splice(cursorLine, 1);
        cursorLine--;
        cursorCol = prevLine.length;
        renderInput();
      }
    }

    function del(): void {
      const line = buf[cursorLine]!;
      if (cursorCol < line.length) {
        buf[cursorLine] = line.slice(0, cursorCol) + line.slice(cursorCol + 1);
        renderInput();
      } else if (cursorLine < buf.length - 1) {
        buf[cursorLine] = line + buf[cursorLine + 1]!;
        buf.splice(cursorLine + 1, 1);
        renderInput();
      }
    }

    function home(): void {
      cursorCol = 0;
      renderInput();
    }

    function end(): void {
      cursorCol = buf[cursorLine]!.length;
      renderInput();
    }

    function handleTab(): void {
      const completer = createCompleter(workspaceRoot);
      const full = getFullInput();
      const [matches, matchLine] = completer(full);
      if (matches.length === 1 && matches[0] !== matchLine) {
        setFullInput(matches[0]!);
        renderInput();
      }
    }

    if (input.isTTY && input.setRawMode) {
      input.setRawMode(true);
    }
    input.resume();
    emitKeypressEvents(input);

    // Safety net: if anything throws while in raw mode, restore it
    function restoreRawMode(): void {
      try {
        if (input.isTTY && input.setRawMode) {
          input.setRawMode(false);
        }
      } catch { /* already restored */ }
      input.removeAllListeners('keypress');
    }

    const PASTE_INTERVALS: number[] = [];
    const PASTE_WINDOW_SIZE = 5;
    const PASTE_THRESHOLD_MS = 80;
    let lastKeyTime = 0;

    function isPasteBurst(): boolean {
      if (PASTE_INTERVALS.length < 2) return false;
      const sorted = [...PASTE_INTERVALS].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      return median < PASTE_THRESHOLD_MS;
    }

    input.on('keypress', (_chunk: Buffer, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) => {
      try {
        const now = Date.now();
        if (lastKeyTime > 0) {
          const interval = now - lastKeyTime;
          if (interval > PASTE_THRESHOLD_MS) {
            PASTE_INTERVALS.length = 0;
          } else {
            PASTE_INTERVALS.push(interval);
            if (PASTE_INTERVALS.length > PASTE_WINDOW_SIZE) PASTE_INTERVALS.shift();
          }
        }
        lastKeyTime = now;

        const name = key.name || '';
        const ctrl = key.ctrl || false;
        const meta = key.meta || false;
        const shift = key.shift || false;

        // Ctrl+C → clean up and exit
        if (ctrl && name === 'c') {
          restoreRawMode();
          process.emit('SIGINT' as any);
          return;
        }

        // Enter: submit only on deliberate press (median interval > threshold). During paste bursts, insert newline.
        if (name === 'enter' && !shift && !meta) {
          if (isPasteBurst()) {
            newline();
          } else {
            submit();
          }
          return;
        }

        // Shift+Enter → newline
        if (name === 'enter' && (shift || meta)) {
          newline();
          return;
        }

        // Tab → autocomplete
        if (name === 'tab') {
          handleTab();
          return;
        }

        // Space (name is 'space', not ' ')
        if (name === 'space') {
          insertChar(' ');
          return;
        }

        // Navigation
        if (name === 'left') { cursorLeft(); return; }
        if (name === 'right') { cursorRight(); return; }
        if (name === 'up' && !ctrl) { cursorUp(); return; }
        if (name === 'down' && !ctrl) { cursorDown(); return; }
        if (name === 'home' || (ctrl && name === 'a')) { home(); return; }
        if (name === 'end' || (ctrl && name === 'e')) { end(); return; }

        // Delete
        if (name === 'backspace') { backspace(); return; }
        if (name === 'delete' || (ctrl && name === 'd' && getFullInput().length > 0)) { del(); return; }

        // Ctrl+W → delete word backward
        if (ctrl && name === 'w') {
          const line = buf[cursorLine]!;
          const before = line.slice(0, cursorCol);
          const after = line.slice(cursorCol);
          const trimmed = before.replace(/\s*\S+\s*$/, '');
          buf[cursorLine] = trimmed + after;
          cursorCol = trimmed.length;
          renderInput();
          return;
        }

        // Ctrl+U → clear line
        if (ctrl && name === 'u') {
          const after = buf[cursorLine]!.slice(cursorCol);
          buf[cursorLine] = after;
          cursorCol = 0;
          renderInput();
          return;
        }

        // Ctrl+K → delete to end of line
        if (ctrl && name === 'k') {
          buf[cursorLine] = buf[cursorLine]!.slice(0, cursorCol);
          renderInput();
          return;
        }

        // Regular character (name length = 1, e.g. letters, numbers, punctuation)
        if (name.length === 1 && !ctrl) {
          insertChar(name);
          return;
        }

        // Handle printable characters (including symbols like '/' or ':' and emojis/surrogate pairs)
        // that Node's keypress doesn't assign a single-character name to, or when pasting.
        const char = _chunk ? _chunk.toString() : '';
        const hasControlChar = [...char].some((c) => {
          const code = c.codePointAt(0) ?? 0;
          return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
        });
        if (char && !ctrl && !meta && !hasControlChar) {
          insertChar(char);
          return;
        }
      } catch (err) {
        restoreRawMode();
        throw err;
      }
    });

    // Initial render
    renderInput();
  });
}
