/**
 * WOS Integration for SC-Agent-CLI
 */

import { WOSReporter } from '@wos/reporter';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

let wosReporter: WOSReporter | null = null;
let sessionCount = 0;
let successfulSessions = 0;
let totalSessions = 0;

/**
 * Initialize WOS reporting
 */
export function initializeWOS(): void {
  const enabled = process.env.WOS_ENABLED === 'true';

  if (!enabled) {
    console.log('[WOS] Reporting disabled (set WOS_ENABLED=true to enable)');
    return;
  }

  wosReporter = new WOSReporter({
    component_id: 'sc-agent-cli',
    hub_url: process.env.WOS_HUB_URL,
    component_secret: process.env.WOS_SECRET,
    enabled: true,
  });

  // Start automatic health reporting every 10 minutes
  wosReporter.startHealthReporting(10, async () => {
    const healthScore = calculateHealthScore();

    return {
      score: healthScore,
      active_tasks: sessionCount,
      success_rate_24h: totalSessions > 0 ? (successfulSessions / totalSessions) * 100 : 100,
      total_operations_24h: totalSessions,
    };
  });

  console.log('[WOS] Reporting initialized for sc-agent-cli');
}

/**
 * Calculate health score
 */
function calculateHealthScore(): number {
  // Health based on success rate
  if (totalSessions === 0) return 100;

  const successRate = (successfulSessions / totalSessions) * 100;

  if (successRate >= 90) return 100;
  if (successRate >= 80) return 90;
  if (successRate >= 70) return 80;
  if (successRate >= 60) return 70;
  if (successRate >= 50) return 60;
  return 50;
}

/**
 * Report session start
 */
export async function reportSessionStart(): Promise<void> {
  sessionCount++;

  if (wosReporter) {
    await wosReporter.report('session_started', {
      active_sessions: sessionCount,
      timestamp: Date.now(),
    });
  }
}

/**
 * Report session end
 */
export async function reportSessionEnd(success: boolean, durationMs: number, messageCount: number): Promise<void> {
  sessionCount = Math.max(0, sessionCount - 1);
  totalSessions++;

  if (success) {
    successfulSessions++;
  }

  if (wosReporter) {
    await wosReporter.reportExecution({
      success,
      duration_ms: durationMs,
      operation: 'chat_session',
      message_count: messageCount,
    });
  }
}

/**
 * Report tool execution
 */
export async function reportToolExecution(tool: string, success: boolean, durationMs: number): Promise<void> {
  if (wosReporter) {
    await wosReporter.report('tool_executed', {
      tool,
      success,
      duration_ms: durationMs,
    });
  }
}

/**
 * Cleanup WOS reporter
 */
export function shutdownWOS(): void {
  if (wosReporter) {
    wosReporter.stop();
    console.log('[WOS] Reporting stopped');
  }
}
