import { AuditLogger } from '../../utils/audit-log.js';
import type { ContextBudgetReport } from '../../utils/context-budget.js';

/**
 * Run-loop audit events (#410). Thin wrapper over AuditLogger so the
 * event shapes used across the agent loop live in one place — every
 * emit stays best-effort (AuditLogger never throws into the run).
 *
 * `model` is passed per call: during orchestration phases (#424) the
 * serving model is the phase's candidate, not the run default.
 */
export class RunAudit {
  constructor(private readonly audit?: AuditLogger) {}

  llmRequest(iteration: number, model: string, messageCount: number, estTokens: number): void {
    this.audit?.emit({ type: 'llm_request', iteration, model, messages: messageCount, est_tokens: estTokens });
  }

  llmResponseOk(iteration: number, model: string, durationMs: number, contentBytes: number, toolCalls: number, estTokens: number): void {
    this.audit?.emit({
      type: 'llm_response', iteration, model,
      duration_ms: durationMs, status: 'ok',
      content_bytes: contentBytes, tool_calls: toolCalls,
      est_tokens: estTokens,
    });
  }

  llmResponseError(iteration: number, model: string, durationMs: number, err: unknown): void {
    this.audit?.emit({
      type: 'llm_response', iteration, model,
      duration_ms: durationMs, status: 'error',
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  toolCall(iteration: number, name: string, args: Record<string, unknown>): void {
    this.audit?.emit({ type: 'tool_call', iteration, name, args_digest: AuditLogger.digest(args) });
  }

  /** Malformed tool arguments — no iteration field (parity with the original emit site). */
  toolArgsParseError(name: string, error: string): void {
    this.audit?.emit({ type: 'tool_result', name, success: false, phase: 'args_parse', error: error.slice(0, 200) });
  }

  /** Mutating call rejected by a read-only orchestration phase (#424). */
  toolDenied(iteration: number, name: string, error: string): void {
    this.audit?.emit({ type: 'tool_result', iteration, name, success: false, phase: 'read_only_phase', error: error.slice(0, 200) });
  }

  toolResultOk(iteration: number, name: string, durationMs: number, resultBytes: number): void {
    this.audit?.emit({ type: 'tool_result', iteration, name, success: true, duration_ms: durationMs, result_bytes: resultBytes });
  }

  toolResultError(iteration: number, name: string, durationMs: number, error: string): void {
    this.audit?.emit({ type: 'tool_result', iteration, name, success: false, duration_ms: durationMs, error: error.slice(0, 200) });
  }

  sandboxViolation(rule: string, target: string): void {
    this.audit?.emit({ type: 'sandbox_violation', rule, target });
  }

  contextBudget(report: ContextBudgetReport): void {
    this.audit?.emit({
      type: 'context_budget',
      budget_tokens: report.budget_tokens,
      requested_tokens: report.requested_tokens,
      injected_tokens: report.injected_tokens,
      trimmed: report.sources.filter(s => s.truncated).map(s => s.source),
    });
  }
}
