/**
 * Example: Using Agent with Callbacks (Native Web Integration)
 *
 * This demonstrates how to use the Agent class with callbacks
 * for UI-agnostic event handling. Perfect for:
 * - Web applications (HTTP/WebSocket)
 * - Custom UIs
 * - Logging systems
 * - Monitoring/analytics
 */

import { Agent } from '../dist/core/agent.js';
import { loadConfig } from '../dist/core/config.js';
import type { AgentCallbacks } from '../dist/core/types.js';

async function main() {
  // Load config
  const config = await loadConfig(process.cwd());
  config.model.model = 'nvidia/nemotron-3-ultra-550b-a55b';

  // Define callbacks for custom UI handling
  const callbacks: AgentCallbacks = {
    onProgress: (event) => {
      console.log(`📊 [PROGRESS] ${event.data.status}`);
    },

    onToolStart: (event) => {
      console.log(`🔧 [TOOL START] ${event.data.name}`);
      console.log(`   Args: ${JSON.stringify(event.data.args)}`);
    },

    onToolComplete: (event) => {
      console.log(`✅ [TOOL DONE] ${event.data.name} (${event.data.duration}ms)`);
      console.log(`   Result: ${event.data.result?.substring(0, 100)}...`);
    },

    onToolError: (event) => {
      console.log(`❌ [TOOL ERROR] ${event.data.name}`);
      console.log(`   Error: ${event.data.error}`);
    },

    onLog: (event) => {
      // Custom log handler (could send to web UI, file, etc.)
      console.log(`📝 [LOG] ${event.data.message}`);
    },

    onComplete: (event) => {
      console.log(`\n✨ [COMPLETE]`);
      console.log(`   Messages: ${event.data.messages.length}`);
      console.log(`   Tools used: ${event.data.toolsUsed.join(', ')}`);
      console.log(`   Iterations: ${event.data.iterations}`);
    },
  };

  // Create agent with callbacks
  const agent = new Agent(
    {
      workspaceRoot: process.cwd(),
      config,
      quiet: true,      // Suppress console.log, use callbacks instead
      autoApprove: true, // Auto-approve tools for demo
      callbacks,         // ← Provide callbacks
    }
  );

  // Execute
  console.log('🚀 Starting agent with callbacks...\n');
  const history = await agent.run('Show me the package.json file contents');

  // Get final response
  const finalMessage = history[history.length - 1];
  console.log(`\n💬 Final response:\n${finalMessage.content}\n`);
}

main().catch(console.error);
