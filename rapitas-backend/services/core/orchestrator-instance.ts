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
import { createLogger } from '../../config/logger';

const log = createLogger('orchestrator-instance');

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

// NOTE: Bun's server.stop(true) promise can hang forever when a connection it
// fails to force-close remains (a /restart was observed stalled indefinitely at
// "Closing listening socket..."). Waiting longer than this cannot help — the
// process exit that follows releases the socket at OS level regardless.
const SERVER_STOP_TIMEOUT_MS = 5_000;

export async function stopServer(): Promise<void> {
  if (!_serverStopCallback) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(_serverStopCallback()).then(() => 'stopped' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), SERVER_STOP_TIMEOUT_MS);
      }),
    ]);
    if (result === 'timeout') {
      log.warn(
        { timeoutMs: SERVER_STOP_TIMEOUT_MS },
        '[stopServer] server stop did not resolve in time — continuing shutdown without it',
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
