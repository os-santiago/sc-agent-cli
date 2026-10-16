import type { AgentCallbacks } from '../types.js';
import { redactSecrets, redactDeep } from '../../utils/secret-redaction.js';

/**
 * Agent event surface — the quiet/callback-aware logging and tool-event
 * emission the run loop produces. Extracted from agent.ts (#493) so the
 * loop only orchestrates; payloads are unchanged (args/results still pass
 * through the #472 redaction layer).
 */
export class AgentEvents {
  constructor(
    private readonly callbacks?: AgentCallbacks,
    private readonly quiet?: boolean,
  ) {}

  /** Conditional log — suppressed in quiet mode; emits onLog callback or console.log. */
  log(...args: Parameters<typeof console.log>): void {
    if (this.quiet) {
      return; // Suppress all logs in quiet mode
    }

    // If callbacks provided, emit log event
    if (this.callbacks?.onLog) {
      const message = args.map(arg =>
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ');

      this.callbacks.onLog({
        type: 'log',
        timestamp: Date.now(),
        data: {
          level: 'info',
          message,
          args,
        },
      });
    } else {
      // Fallback to console.log (CLI mode)
      console.log(...args);
    }
  }

  /** Emit progress event */
  progress(status: string, step?: number, total?: number): void {
    this.callbacks?.onProgress?.({
      type: 'progress',
      timestamp: Date.now(),
      data: { status, step, total },
    });
  }

  /** Emit tool start event */
  toolStart(name: string, args: any): void {
    this.callbacks?.onToolStart?.({
      type: 'tool_start',
      timestamp: Date.now(),
      data: { name, args: redactDeep(args) },
    });
  }

  /** Emit tool complete event */
  toolComplete(name: string, result: string, duration: number): void {
    this.callbacks?.onToolComplete?.({
      type: 'tool_complete',
      timestamp: Date.now(),
      data: { name, result: redactSecrets(result ?? ''), duration },
    });
  }

  /** Emit tool error event */
  toolError(name: string, error: string): void {
    this.callbacks?.onToolError?.({
      type: 'tool_error',
      timestamp: Date.now(),
      data: { name, error: redactSecrets(error) },
    });
  }
}
