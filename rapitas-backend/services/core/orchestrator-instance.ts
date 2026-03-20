/**
 * Shared orchestrator singleton instance
 *
 * In the main process, delegates to worker processes via AgentWorkerManager,
 * isolating agent execution from the main event loop.
 *
 * AgentWorkerManager shares the same method interface as AgentOrchestrator
 * and delegates processing to the worker orchestrator via IPC.
 * SSE broadcasts are achieved by the manager receiving IPC events from workers
 * and forwarding them to realtimeService.
 */
import { AgentWorkerManager } from '../agents/agent-worker-manager';

// Use AgentWorkerManager in the main process
const workerManager = AgentWorkerManager.getInstance();

// Export as orchestrator for backward compatibility with routers
export { workerManager as orchestrator };

// Also export the worker manager itself (for initialize/shutdown calls)
export { workerManager };

/**
 * Server stop callback.
 * Registered with app.stop() in index.ts and invoked during system-router shutdown.
 */
let _serverStopCallback: (() => Promise<void> | void) | null = null;

export function setServerStopCallback(callback: () => Promise<void> | void): void {
  _serverStopCallback = callback;
}

export async function stopServer(): Promise<void> {
  if (_serverStopCallback) {
    await _serverStopCallback();
  }
}
