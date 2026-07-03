/**
 * Agent Worker Shutdown
 *
 * Graceful shutdown and startup initialization for the agent worker process.
 * Handles SIGTERM/SIGKILL sequencing and stale worktree cleanup on startup.
 * Not responsible for crash recovery, health checks, or IPC protocol.
 */

import { createLogger } from '../../../config/logger';
import { cleanupZombieProcesses } from '../agent-process-tracker';
import { sendIPCRequest, rejectAllPendingRequests } from './ipc';
import { setupWorker } from './lifecycle';
import type { WorkerState } from './lifecycle';
import { SHUTDOWN_ERROR_MESSAGE } from './shutdown-error';

const logger = createLogger('agent-worker-manager:shutdown');

/**
 * Gracefully shut down the worker process.
 * Sends a shutdown IPC request, then SIGTERM, then SIGKILL after 5 seconds.
 *
 * @param state - Mutable worker state object / ワーカー状態オブジェクト
 */
export async function gracefulShutdown(state: WorkerState): Promise<void> {
  if (state.isShuttingDown) {
    return;
  }

  state.isShuttingDown = true;
  logger.info('[AgentWorkerManager] Starting graceful shutdown');

  if (state.healthCheckInterval) {
    clearInterval(state.healthCheckInterval);
    state.healthCheckInterval = null;
  }

  // Notify the worker to shut down
  if (state.workerProcess && state.isWorkerReady) {
    try {
      await sendIPCRequest(
        state.workerProcess,
        state.isWorkerReady,
        state.pendingRequests,
        () => `req_${Date.now()}_shutdown`,
        'shutdown',
        {},
        8000,
      );
    } catch (error) {
      logger.warn({ err: error }, '[AgentWorkerManager] Shutdown request to worker failed');
    }
  }

  rejectAllPendingRequests(state.pendingRequests, new Error(SHUTDOWN_ERROR_MESSAGE));

  if (state.workerProcess) {
    try {
      if (!state.workerProcess.killed) {
        state.workerProcess.kill('SIGTERM');
      }

      // NOTE: `.killed` flips true as soon as kill() successfully SENDS a
      // signal — it does not mean the process has actually exited. Using it
      // as the "still alive" check here meant this SIGKILL escalation could
      // never fire (killed was already true right after the SIGTERM above),
      // so a worker that ignored SIGTERM would hang shutdown indefinitely.
      // Track real exit via the 'exit' event instead.
      let hasExited = false;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (state.workerProcess && !hasExited) {
            logger.warn('[AgentWorkerManager] Force killing worker process');
            state.workerProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        state.workerProcess!.on('exit', () => {
          hasExited = true;
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch (error) {
      logger.error({ err: error }, '[AgentWorkerManager] Error during worker shutdown');
    }

    state.workerProcess = null;
  }

  logger.info('[AgentWorkerManager] Graceful shutdown complete');
}

/**
 * Initialize the worker manager: clean up zombies, start worker, clean stale worktrees.
 *
 * @param state - Mutable worker state object / ワーカー状態オブジェクト
 * @param cleanupStaleWorktreesFn - Function to clean stale worktrees / stale worktreeクリーンアップ関数
 * @param projectRoot - Repository root used for worktree cleanup / リポジトリルートパス
 */
export async function initializeWorker(
  state: WorkerState,
  cleanupStaleWorktreesFn: (baseDir: string) => Promise<number>,
  projectRoot: string,
): Promise<void> {
  // NOTE: Clean up zombie processes remaining from a previous crash before starting
  cleanupZombieProcesses();
  await setupWorker(state);

  // NOTE: Clean up stale worktrees from previous crashes after worker is ready
  try {
    const cleanedCount = await cleanupStaleWorktreesFn(projectRoot);
    if (cleanedCount > 0) {
      logger.info(`[AgentWorkerManager] Cleaned up ${cleanedCount} stale worktrees on startup`);
    }
  } catch (error) {
    logger.warn({ err: error }, '[AgentWorkerManager] Stale worktree cleanup failed on startup');
  }
}
