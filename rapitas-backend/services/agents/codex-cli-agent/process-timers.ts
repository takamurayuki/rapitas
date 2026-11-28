/**
 * CodexCliAgent — Process Timers
 *
 * Idle-check and no-output-timeout intervals for the Codex CLI child process.
 * While self-verification runs in the agent's worktree the no-output timeout
 * is held (the agent is waiting on the gate, not hung). Split out of
 * process-runner.ts; not responsible for spawning or parsing output.
 */
import type { AgentExecutionResult } from '../base-agent';
import { createLogger } from '../../../config/logger';
import {
  REAL_MONITOR_CLOCK,
  type MonitorClock,
  type SelfVerificationReporter,
} from '../../workflow/self-verification-activity/activity-reporter';
import type { ProcessRunnerCallbacks, ProcessRunnerState } from './process-runner';

const logger = createLogger('codex-cli-agent/process-runner');

/** Milliseconds of idle stdout before flushing incomplete line buffer. */
const OUTPUT_IDLE_TIMEOUT = 30000;

/** Milliseconds before warning that no output has been received at all. */
const INITIAL_OUTPUT_TIMEOUT = 60000;

/** Interval for idle-check polling. */
const IDLE_CHECK_INTERVAL_MS = 5000;

/** Interval for timeout-check polling. */
const TIMEOUT_CHECK_INTERVAL_MS = 10000;

/** Cleanup functions for process timers */
export interface ProcessTimers {
  cleanupIdle: () => void;
  cleanupTimeout: () => void;
  updateLastOutputTime: () => void;
  markOutputReceived: () => void;
}

/** Optional collaborators; omitted = pre-1582 behaviour with real timers. */
export interface ProcessTimerOptions {
  /** Self-verification view for this worktree (hold + display lines). */
  selfVerification?: Pick<SelfVerificationReporter, 'isActive' | 'tick'>;
  clock?: MonitorClock;
}

/**
 * Create idle and timeout check intervals for process monitoring.
 *
 * @param state - Shared runner state (process, buffers, status) / 実行状態
 * @param callbacks - Agent callbacks / エージェントへのコールバック
 * @param startTime - Execution start (ms epoch) / 実行開始時刻
 * @param timeout - No-output timeout in ms / 無出力の上限(ms)
 * @param resolve - Resolves the execution on timeout / タイムアウト時の解決関数
 * @param options - Self-verification hold and clock / 自己検証の保留と時計
 * @returns Timer handles / タイマー操作
 */
export function createProcessTimers(
  state: ProcessRunnerState,
  callbacks: ProcessRunnerCallbacks,
  startTime: number,
  timeout: number,
  resolve: (result: AgentExecutionResult) => void,
  options: ProcessTimerOptions = {},
): ProcessTimers {
  const { logPrefix } = callbacks;
  const clock = options.clock ?? REAL_MONITOR_CLOCK;
  const sv = options.selfVerification;
  let lastOutputTime = clock.now();
  let hasReceivedAnyOutput = false;

  // NOTE: Task 1582 — a CLI waiting on self-verification is silent for minutes;
  // keep the idle clock at "now" while the gate runs so the timeout below only
  // counts silence after verification has ended.
  const holdForSelfVerification = () => {
    if (sv?.isActive()) lastOutputTime = clock.now();
  };

  const idleCheckInterval = clock.setInterval(() => {
    sv?.tick();
    holdForSelfVerification();
    const idleTime = clock.now() - lastOutputTime;
    const totalElapsed = clock.now() - startTime;

    if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
      logger.warn(`${logPrefix} No output received after ${Math.floor(totalElapsed / 1000)}s`);
      callbacks.emitOutput(
        `\n[情報] ${Math.floor(totalElapsed / 1000)}秒経過: Codex は内部処理中です。応答をお待ちください。タイムアウトは ${Math.floor(timeout / 1000)}秒です。\n`,
      );
      hasReceivedAnyOutput = true;
    }

    if (idleTime > OUTPUT_IDLE_TIMEOUT && state.lineBuffer.trim()) {
      logger.info(`${logPrefix} Holding partial stdout line while waiting for newline`);
    }
  }, IDLE_CHECK_INTERVAL_MS);

  const timeoutCheckInterval = clock.setInterval(() => {
    holdForSelfVerification();
    if (state.process && !state.process.killed) {
      if (clock.now() - lastOutputTime >= timeout) {
        clock.clearInterval(timeoutCheckInterval);
        clock.clearInterval(idleCheckInterval);
        callbacks.emitOutput(
          `\n${logPrefix} Execution timed out (no output for ${timeout / 1000}s)\n`,
          true,
        );
        state.process.kill('SIGTERM');
        state.status = 'failed';
        callbacks.onStatusChange('failed');
        resolve({
          success: false,
          output: state.outputBuffer,
          errorMessage: `Execution timed out (no output for ${timeout / 1000}s)`,
          executionTimeMs: clock.now() - startTime,
        });
      }
    }
  }, TIMEOUT_CHECK_INTERVAL_MS);

  return {
    cleanupIdle: () => clock.clearInterval(idleCheckInterval),
    cleanupTimeout: () => clock.clearInterval(timeoutCheckInterval),
    updateLastOutputTime: () => {
      lastOutputTime = clock.now();
    },
    markOutputReceived: () => {
      if (!hasReceivedAnyOutput) {
        hasReceivedAnyOutput = true;
        logger.info(`${logPrefix} First stdout after ${clock.now() - startTime}ms`);
      }
    },
  };
}
