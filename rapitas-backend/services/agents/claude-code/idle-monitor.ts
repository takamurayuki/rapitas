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
import {
  REAL_MONITOR_CLOCK,
  type MonitorClock,
} from '../../workflow/self-verification-activity/activity-reporter';

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
  /** Setter for wallClockTimeoutForceKilled flag (wall-clock cap only, not idle hangs) */
  setWallClockTimeoutForceKilled: (value: boolean) => void;
  /** Getter for current outputBuffer content (for timeout error message) */
  getOutputBuffer: () => string;
  /** Getter for current errorBuffer content (for timeout error message) */
  getErrorBuffer: () => string;
  /**
   * Whether self-verification is running in this agent's worktree. While it
   * is, silence is expected (the agent is waiting on the gate), so both idle
   * windows are held open. Omitted = never active (pre-1582 behaviour).
   */
  isSelfVerificationActive?: () => boolean;
  /** Called on every idle check (5 s); the self-verification reporter emits its lines here. */
  onTick?: () => void;
};

/** Why the monitor force-kills the process tree. */
export type IdleKillReason = 'idle-hang' | 'wall-clock';

/** Injectable time and kill primitives (tests drive these). */
export type IdleMonitorDeps = {
  clock?: MonitorClock;
  killTree?: (proc: ChildProcess, reason: IdleKillReason) => void;
};

/** Kill the CLI and its children: taskkill /T on Windows, SIGTERM elsewhere. */
function killProcessTree(logPrefix: string, proc: ChildProcess, reason: IdleKillReason): void {
  const pid = proc.pid;
  if (process.platform !== 'win32') {
    proc.kill('SIGTERM');
    return;
  }
  try {
    if (pid) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
      logger.info(`${logPrefix} Process ${pid} killed via taskkill (${reason})`);
    }
  } catch (e) {
    logger.warn({ err: e }, `${logPrefix} taskkill failed (${reason}), trying process.kill()`);
    try {
      proc.kill();
    } catch (killErr) {
      logger.warn({ err: killErr }, `${logPrefix} process.kill() also failed (${reason})`);
    }
  }
}

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
 * @param deps - Clock and kill overrides for tests / テスト用の時計とkill
 * @returns Handles to control the timers / タイマーを制御するハンドル
 */
export function startIdleMonitor(
  logPrefix: string,
  timeout: number,
  startTime: number,
  callbacks: IdleMonitorCallbacks,
  deps: IdleMonitorDeps = {},
): IdleMonitorHandles {
  const clock = deps.clock ?? REAL_MONITOR_CLOCK;
  const killTree = deps.killTree ?? ((proc, reason) => killProcessTree(logPrefix, proc, reason));
  let lastOutputTime = clock.now();
  let hasReceivedAnyOutput = false;
  let holdLogged = false;

  const OUTPUT_IDLE_TIMEOUT = 30000; // 30 seconds
  const INITIAL_OUTPUT_TIMEOUT = 60000; // Initial output timeout: 60 seconds
  const MAX_OUTPUT_IDLE_TIMEOUT = 300000; // 5 min: treat as hung if idle for 5 min after output

  const idleCheckInterval = clock.setInterval(() => {
    callbacks.onTick?.();
    // NOTE: Task 1582 — a CLI waiting on self-verification prints nothing for
    // minutes and was killed as hung. While the gate runs, keep the idle clock
    // at "now" so the 5-minute rule (and the no-output timeout below) only
    // starts counting once verification has ended. The wall-clock cap is not held.
    if (callbacks.isSelfVerificationActive?.()) {
      lastOutputTime = clock.now();
      if (!holdLogged) {
        holdLogged = true;
        logger.info(`${logPrefix} Self-verification running — holding idle-hang detection`);
      }
    } else {
      holdLogged = false;
    }
    const idleTime = clock.now() - lastOutputTime;
    const totalElapsed = clock.now() - startTime;

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
      clock.clearInterval(idleCheckInterval);
      killTree(proc, 'idle-hang');
    }

    // Wall-clock hard cap. BOTH checks here (and the timeoutCheckInterval below)
    // are IDLE-based — they measure time since the LAST output. An agent that keeps
    // emitting output but never makes progress (an endless thinking loop) therefore
    // resets the idle timer forever and is NEVER killed: task 286 ran 34 min past
    // its 28-min budget exactly this way. Enforce the configured timeout as a TRUE
    // wall-clock ceiling, regardless of how chatty the agent is. Mirrors the
    // idle-hang kill above; the process 'close' handler resolves the execution.
    if (totalElapsed >= timeout && callbacks.getStatus() === 'running' && proc && !proc.killed) {
      logger.warn(
        `${logPrefix} WALL-CLOCK TIMEOUT: ${Math.floor(totalElapsed / 1000)}s elapsed (cap ${Math.floor(timeout / 1000)}s) — force-killing.`,
      );
      callbacks.onFlushLineBuffer(
        `\n[Timeout] ${Math.floor(totalElapsed / 1000)} 秒経過（上限 ${Math.floor(timeout / 1000)} 秒）。実行を強制終了します。\n`,
      );
      callbacks.setIdleTimeoutForceKilled(true);
      // NOTE: Also tag the wall-clock cause so downstream classification can tell
      // this kill apart from an idle hang — a wall-clock kill is not a provider
      // error and must not trigger a provider cooldown (task 546).
      callbacks.setWallClockTimeoutForceKilled(true);
      clock.clearInterval(idleCheckInterval);
      killTree(proc, 'wall-clock');
    }
  }, 5000); // Check every 5 seconds

  const timeoutCheckInterval = clock.setInterval(() => {
    const proc = callbacks.getProcess();
    if (proc && !proc.killed) {
      const timeSinceLastOutput = clock.now() - lastOutputTime;

      if (timeSinceLastOutput >= timeout) {
        logger.info(`${logPrefix} TIMEOUT: No output for ${timeout / 1000}s`);
        logger.info(`${logPrefix} Last output was ${Math.floor(timeSinceLastOutput / 1000)}s ago`);
        logger.info(`${logPrefix} Output so far: ${callbacks.getOutputBuffer().substring(0, 500)}`);
        logger.info(`${logPrefix} Error so far: ${callbacks.getErrorBuffer().substring(0, 500)}`);
        logger.info(`${logPrefix} LineBuffer: ${callbacks.getLineBuffer().substring(0, 500)}`);
        clock.clearInterval(timeoutCheckInterval);
        clock.clearInterval(idleCheckInterval);
        callbacks.onFlushLineBuffer(
          `\n${logPrefix} Execution timed out (no output for ${timeout / 1000}s)\n`,
        );
        proc.kill('SIGTERM');
        callbacks.onTimeout({
          success: false,
          output: callbacks.getOutputBuffer(),
          errorMessage: `Execution timed out (no output for ${timeout / 1000}s)`,
          executionTimeMs: clock.now() - startTime,
        });
      }
    }
  }, 10000);

  return {
    cleanup() {
      clock.clearInterval(idleCheckInterval);
      clock.clearInterval(timeoutCheckInterval);
    },
    recordOutput() {
      lastOutputTime = clock.now();
    },
    markReceivedOutput() {
      hasReceivedAnyOutput = true;
    },
  };
}
