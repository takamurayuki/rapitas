/**
 * ClaudeCodeAgent Idle Monitor
 *
 * Creates and manages interval-based idle timeout and output timeout timers
 * for the Claude Code CLI child process. Detects hung processes and resolves
 * the execution promise on timeout.
 * Not responsible for spawning, output parsing, or question detection.
 */

import { execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createLogger } from '../../../config/logger';
import type { AgentExecutionResult } from '../base-agent';

const logger = createLogger('claude-code-agent');

export type IdleMonitorCallbacks = {
  /** Called when the monitor flushes the line buffer due to idle */
  onFlushLineBuffer: (content: string) => void;
  /** Called when the output timeout elapses and execution should resolve as failed */
  onTimeout: (result: AgentExecutionResult) => void;
  /** Getter for current lineBuffer content */
  getLineBuffer: () => string;
  /** Getter for current outputBuffer length */
  getOutputBufferLength: () => number;
  /** Getter for current status */
  getStatus: () => string;
  /** Getter for the child process reference */
  getProcess: () => ChildProcess | null;
  /** Setter for idleTimeoutForceKilled flag */
  setIdleTimeoutForceKilled: (value: boolean) => void;
  /** Getter for current outputBuffer content (for timeout error message) */
  getOutputBuffer: () => string;
  /** Getter for current errorBuffer content (for timeout error message) */
  getErrorBuffer: () => string;
};

export type IdleMonitorHandles = {
  /** Stop and clean up both timers */
  cleanup: () => void;
  /** Update the last-output timestamp to reset both timeout windows */
  recordOutput: () => void;
  /** Mark that at least one output chunk has been received */
  markReceivedOutput: () => void;
};

/**
 * Starts the idle-check interval and output-timeout interval for a running process.
 * Returns handles to stop them and update the last-output timestamp.
 *
 * @param logPrefix - Logger prefix for this agent instance / ロガーのプレフィックス
 * @param timeout - Max milliseconds of silence before treating execution as timed out / タイムアウトまでのミリ秒
 * @param startTime - Timestamp when execution began / 実行開始タイムスタンプ
 * @param callbacks - Callbacks into the agent instance / エージェントインスタンスへのコールバック
 * @returns Handles to control the timers / タイマーを制御するハンドル
 */
export function startIdleMonitor(
  logPrefix: string,
  timeout: number,
  startTime: number,
  callbacks: IdleMonitorCallbacks,
): IdleMonitorHandles {
  let lastOutputTime = Date.now();
  let hasReceivedAnyOutput = false;

  const OUTPUT_IDLE_TIMEOUT = 30000; // 30 seconds
  const INITIAL_OUTPUT_TIMEOUT = 60000; // Initial output timeout: 60 seconds
  const MAX_OUTPUT_IDLE_TIMEOUT = 300000; // 5 min: treat as hung if idle for 5 min after output

  const idleCheckInterval = setInterval(() => {
    const idleTime = Date.now() - lastOutputTime;
    const totalElapsed = Date.now() - startTime;

    // Warn if no output received after 60 seconds (only once)
    if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
      logger.warn(
        `${logPrefix} WARNING: No output received after ${Math.floor(totalElapsed / 1000)}s - Claude Code may not be responding`,
      );
      callbacks.onFlushLineBuffer(
        `\n[Warning] ${Math.floor(totalElapsed / 1000)} seconds elapsed without response from Claude Code. Continuing processing...\n`,
      );
      hasReceivedAnyOutput = true; // NOTE: Set to prevent this warning from firing repeatedly
    }

    const lineBufferContent = callbacks.getLineBuffer();
    if (idleTime > OUTPUT_IDLE_TIMEOUT && lineBufferContent.trim()) {
      logger.info(
        `${logPrefix} Output idle for ${idleTime}ms, flushing lineBuffer (${lineBufferContent.length} chars)`,
      );
      callbacks.onFlushLineBuffer(lineBufferContent + '\n');
    }

    // Periodic status log for debugging
    if (callbacks.getStatus() === 'running' && idleTime > 10000) {
      logger.info(
        `${logPrefix} Still running... Output idle: ${Math.floor(idleTime / 1000)}s, Buffer: ${lineBufferContent.length} chars, Total output: ${callbacks.getOutputBufferLength()} chars, HasOutput: ${hasReceivedAnyOutput}`,
      );
    }

    // Idle hang detection: if idle for MAX_OUTPUT_IDLE_TIMEOUT after producing output, treat as hung
    const proc = callbacks.getProcess();
    if (
      hasReceivedAnyOutput &&
      idleTime > MAX_OUTPUT_IDLE_TIMEOUT &&
      !lineBufferContent.trim() &&
      callbacks.getStatus() === 'running' &&
      proc &&
      !proc.killed
    ) {
      logger.warn(
        `${logPrefix} OUTPUT IDLE HANG DETECTED: No output for ${Math.floor(idleTime / 1000)}s after producing ${callbacks.getOutputBufferLength()} chars. Force-killing hung process.`,
      );
      callbacks.onFlushLineBuffer(
        `\n${logPrefix} Process has been unresponsive for ${Math.floor(idleTime / 1000)} seconds, treating as hang and force-terminating.\n`,
      );
      callbacks.setIdleTimeoutForceKilled(true);
      clearInterval(idleCheckInterval);

      const pid = proc.pid;
      if (process.platform === 'win32') {
        try {
          if (pid) {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
            logger.info(`${logPrefix} Process ${pid} killed via taskkill (idle hang)`);
          }
        } catch (e) {
          logger.warn(
            { err: e },
            `${logPrefix} taskkill failed (idle hang), trying process.kill()`,
          );
          try {
            proc.kill();
          } catch (killErr) {
            logger.warn({ err: killErr }, `${logPrefix} process.kill() also failed (idle hang)`);
          }
        }
      } else {
        proc.kill('SIGTERM');
      }
    }
  }, 5000); // Check every 5 seconds

  const timeoutCheckInterval = setInterval(() => {
    const proc = callbacks.getProcess();
    if (proc && !proc.killed) {
      const timeSinceLastOutput = Date.now() - lastOutputTime;

      if (timeSinceLastOutput >= timeout) {
        logger.info(`${logPrefix} TIMEOUT: No output for ${timeout / 1000}s`);
        logger.info(`${logPrefix} Last output was ${Math.floor(timeSinceLastOutput / 1000)}s ago`);
        logger.info(`${logPrefix} Output so far: ${callbacks.getOutputBuffer().substring(0, 500)}`);
        logger.info(`${logPrefix} Error so far: ${callbacks.getErrorBuffer().substring(0, 500)}`);
        logger.info(`${logPrefix} LineBuffer: ${callbacks.getLineBuffer().substring(0, 500)}`);
        clearInterval(timeoutCheckInterval);
        clearInterval(idleCheckInterval);
        callbacks.onFlushLineBuffer(
          `\n${logPrefix} Execution timed out (no output for ${timeout / 1000}s)\n`,
        );
        proc.kill('SIGTERM');
        callbacks.onTimeout({
          success: false,
          output: callbacks.getOutputBuffer(),
          errorMessage: `Execution timed out (no output for ${timeout / 1000}s)`,
          executionTimeMs: Date.now() - startTime,
        });
      }
    }
  }, 10000);

  return {
    cleanup() {
      clearInterval(idleCheckInterval);
      clearInterval(timeoutCheckInterval);
    },
    recordOutput() {
      lastOutputTime = Date.now();
    },
    markReceivedOutput() {
      hasReceivedAnyOutput = true;
    },
  };
}
