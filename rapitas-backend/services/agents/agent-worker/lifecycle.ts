/**
 * Agent Worker Lifecycle
 *
 * Manages the worker subprocess lifecycle: spawn, health-check, and crash recovery.
 * Shutdown and initialization logic lives in worker-shutdown.ts.
 * Not responsible for IPC protocol, event bridging, shutdown, or public API methods.
 */

import type { ChildProcess } from 'child_process';
import { join } from 'path';
import { createLogger } from '../../../config/logger';
import { registerProcess, unregisterProcess } from '../agent-process-tracker';
import { rejectAllPendingRequests, sendIPCRequest, type PendingRequest } from './ipc';
import { handleWorkerMessage } from './event-bridge';

const logger = createLogger('agent-worker-manager:lifecycle');

export interface WorkerState {
  workerProcess: ChildProcess | null;
  isWorkerReady: boolean;
  isShuttingDown: boolean;
  healthCheckInterval: ReturnType<typeof setInterval> | null;
  restartPromise: Promise<void> | null;
  requestIdCounter: number;
  readyResolve: (() => void) | null;
  pendingRequests: Map<string, PendingRequest>;
  cachedActiveCount: number;
}

/**
 * Spawn the agent worker process and wait until it signals readiness.
 *
 * @param state - Mutable worker state object / ワーカー状態オブジェクト
 * @throws {Error} When worker fails to start or times out after 30 seconds
 */
export async function setupWorker(state: WorkerState): Promise<void> {
  if (state.isShuttingDown) {
    return;
  }

  try {
    const workerPath = join(process.cwd(), 'workers', 'agent-worker.ts');
    logger.info({ workerPath }, '[AgentWorkerManager] Starting agent worker process');

    // Use spawn to start in the Bun environment
    const { spawn } = await import('child_process');
    state.workerProcess = spawn('bun', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      windowsHide: true, // NOTE: Prevents TCP handle inheritance — stops child process from holding port 3001 socket
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'development',
        AGENT_WORKER: '1',
      },
      cwd: process.cwd(),
    });

    // Register PID for tracking even after crashes
    if (state.workerProcess.pid) {
      registerProcess({
        pid: state.workerProcess.pid,
        role: 'worker',
        startedAt: new Date().toISOString(),
        parentPid: process.pid,
      });
    }

    // Create a Promise for the ready state
    const readyPromise = new Promise<void>((resolve) => {
      state.readyResolve = resolve;
    });

    // IPC message handler
    state.workerProcess.on('message', (message: Record<string, unknown>) => {
      handleWorkerMessage(message, state.pendingRequests, {
        onReady: (_pid) => {
          state.isWorkerReady = true;
          if (state.readyResolve) {
            state.readyResolve();
            state.readyResolve = null;
          }
        },
        onShuttingDown: (_signal) => {
          state.isWorkerReady = false;
        },
      });
    });

    state.workerProcess.on('error', (error) => {
      logger.error({ err: error }, '[AgentWorkerManager] Worker process error');
      handleWorkerCrash(state);
    });

    state.workerProcess.on('exit', (code, signal) => {
      logger.warn({ code, signal }, '[AgentWorkerManager] Worker process exited');
      if (state.workerProcess?.pid) {
        unregisterProcess(state.workerProcess.pid);
      }
      state.isWorkerReady = false;

      if (!state.isShuttingDown) {
        handleWorkerCrash(state);
      }
    });

    // STDIO stream handling
    if (state.workerProcess.stdout) {
      state.workerProcess.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim();
        if (lines) {
          logger.debug(`[AgentWorker stdout] ${lines}`);
        }
      });
    }

    if (state.workerProcess.stderr) {
      state.workerProcess.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().trim();
        if (lines) {
          logger.warn(`[AgentWorker stderr] ${lines}`);
        }
      });
    }

    // Wait for worker startup to complete (timeout: 30 seconds)
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Worker startup timeout')), 30000);
    });

    await Promise.race([readyPromise, timeoutPromise]);

    // Start health check
    startHealthCheck(state);

    logger.info('[AgentWorkerManager] Agent worker manager initialized successfully');
  } catch (error) {
    logger.error({ err: error }, '[AgentWorkerManager] Failed to setup worker');
    throw error;
  }
}

/**
 * Handle a worker crash by rejecting pending requests and scheduling a restart.
 *
 * @param state - Mutable worker state object / ワーカー状態オブジェクト
 */
export async function handleWorkerCrash(state: WorkerState): Promise<void> {
  if (state.isShuttingDown || state.restartPromise) {
    return;
  }

  logger.warn('[AgentWorkerManager] Worker crashed, attempting restart...');
  rejectAllPendingRequests(state.pendingRequests, new Error('Worker process crashed'));

  state.restartPromise = restartWorker(state);
  await state.restartPromise;
  state.restartPromise = null;
}

async function restartWorker(state: WorkerState): Promise<void> {
  try {
    if (state.healthCheckInterval) {
      clearInterval(state.healthCheckInterval);
      state.healthCheckInterval = null;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    await setupWorker(state);
    logger.info('[AgentWorkerManager] Worker successfully restarted');
  } catch (error) {
    logger.error({ err: error }, '[AgentWorkerManager] Failed to restart worker');

    setTimeout(() => {
      if (!state.isShuttingDown) {
        handleWorkerCrash(state);
      }
    }, 5000);
  }
}

/**
 * Start the periodic health-check timer.
 * Polls the worker every 30 seconds via IPC; triggers crash recovery on failure.
 *
 * @param state - Mutable worker state object / ワーカー状態オブジェクト
 */
export function startHealthCheck(state: WorkerState): void {
  if (state.healthCheckInterval) {
    clearInterval(state.healthCheckInterval);
  }

  state.healthCheckInterval = setInterval(async () => {
    if (state.isShuttingDown || !state.isWorkerReady) {
      return;
    }

    try {
      const result = await sendIPCRequest(
        state.workerProcess,
        state.isWorkerReady,
        state.pendingRequests,
        () => `req_${Date.now()}_hc`,
        'get-status',
        {},
        5000,
      );
      const status = result as { activeExecutionCount: number };
      state.cachedActiveCount = status.activeExecutionCount;
    } catch (error) {
      logger.error({ err: error }, '[AgentWorkerManager] Health check failed');
      handleWorkerCrash(state);
    }
  }, 30000);
}
