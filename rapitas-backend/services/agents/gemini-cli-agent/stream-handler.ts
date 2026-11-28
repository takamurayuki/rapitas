/**
 * GeminiCliAgent — StreamHandler
 *
 * Processes the stdout line-by-line stream from the Gemini CLI process.
 * Handles JSON event parsing, question detection, idle monitoring, and timeout enforcement.
 * Not responsible for process spawning, prompt building, or artifact extraction.
 */

import type { ChildProcess } from 'child_process';
import type { GeminiCliAgentConfig } from './types';
import type { QuestionWaitingState } from '../question-detection';
import { createLogger } from '../../../config/logger';
import { filterCliDiagnosticOutput, shouldHideRawCliLine } from '../cli-output-filter';
import { createGeminiQuotaGuard } from './quota-guard';
import { handleGeminiStreamLine } from './stream-line-handler';
import {
  createSelfVerificationReporter,
  REAL_MONITOR_CLOCK,
  type MonitorClock,
} from '../../workflow/self-verification-activity/activity-reporter';
import type { ActivityStore } from '../../workflow/self-verification-activity/activity-store';
import {
  unregisterProcess,
  killProcessTreeSafely,
  captureDescendants,
} from '../agent-process-tracker';

const logger = createLogger('gemini-cli-agent:stream-handler');

export type StreamHandlerCallbacks = {
  onOutput: (text: string, isError?: boolean) => void;
  onOutputBufferAppend: (text: string) => void;
  onErrorBufferAppend: (text: string) => void;
  onSessionIdUpdate: (id: string) => void;
  onCheckpointIdUpdate: (id: string) => void;
  onQuestionDetected: (state: QuestionWaitingState) => void;
  onQuestionEmit: (data: {
    question: string;
    questionType: string | undefined;
    questionDetails: unknown;
    questionKey: unknown;
  }) => void;
  onKillProcess: () => void;
};

/** Self-verification wiring (task 1582); omitted = pre-1582 behaviour. */
export type GeminiSelfVerificationOptions = {
  /** Worktree the CLI runs in. */
  workDir: string;
  /** True once a stop was requested; ends the post-close wait. */
  isCancelled: () => boolean;
  clock?: MonitorClock;
  /** Test seams for the marker store and the wait's sleep. */
  store?: ActivityStore;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Attach stdout/stderr handlers to the Gemini CLI process and manage idle/timeout monitoring.
 * Calls the provided resolve callback when the process closes.
 *
 * @param proc - The spawned Gemini CLI process / GeminiCLIプロセス
 * @param config - Agent configuration (for timeout) / エージェント設定
 * @param startTime - Execution start timestamp / 実行開始タイムスタンプ
 * @param logPrefix - Log prefix for identification / ログ識別プレフィックス
 * @param activeTools - Map of active tool calls shared with parseStreamEvent / アクティブツールマップ
 * @param sessionState - Mutable session/checkpoint ID state / セッション/チェックポイントID状態
 * @param detectedQuestionRef - Mutable ref to the current question waiting state / 質問待機状態参照
 * @param callbacks - Action callbacks for the agent class / エージェントクラスへのコールバック
 * @param onClose - Called when the process closes, with exit code / プロセス終了時のコールバック
 * @param onStatusFailed - Called to set status = 'failed' and resolve the outer promise / 失敗時のコールバック
 * @param selfVerification - Worktree and stop check for the self-verification hold / 自己検証の保留設定
 * @returns Interval cleanup handles / タイマー停止関数
 */
export function attachStreamHandlers(
  proc: ChildProcess,
  config: GeminiCliAgentConfig,
  startTime: number,
  logPrefix: string,
  activeTools: Map<string, { name: string; startTime: number; info: string }>,
  sessionState: { sessionId: string | null; checkpointId: string | null },
  detectedQuestionRef: { value: QuestionWaitingState },
  callbacks: StreamHandlerCallbacks,
  onClose: (code: number | null) => void,
  onStatusFailed: () => void,
  selfVerification?: GeminiSelfVerificationOptions,
): { cleanupIdleCheck: () => void; cleanupTimeoutCheck: () => void } {
  const timeout = config.timeout ?? 900000;
  const clock = selfVerification?.clock ?? REAL_MONITOR_CLOCK;
  // NOTE: Task 1582 — display-only waiting/result lines, and the hold below.
  const reporter = selfVerification
    ? createSelfVerificationReporter({
        workDir: selfVerification.workDir,
        executionStartedAt: startTime,
        emit: (line) => callbacks.onOutput(line),
        store: selfVerification.store,
        sleep: selfVerification.sleep,
      })
    : null;
  // A CLI waiting on the gate is silent; keep the idle clock at "now" while it runs.
  const holdForSelfVerification = () => {
    if (reporter?.isActive()) lastOutputTime = clock.now();
  };

  let lastOutputTime = clock.now();
  let hasReceivedAnyOutput = false;
  let lineBuffer = '';
  const OUTPUT_IDLE_TIMEOUT = 30000;
  const INITIAL_OUTPUT_TIMEOUT = 60000;

  const idleCheckInterval = clock.setInterval(() => {
    reporter?.tick();
    holdForSelfVerification();
    const idleTime = clock.now() - lastOutputTime;
    const totalElapsed = clock.now() - startTime;

    if (!hasReceivedAnyOutput && totalElapsed > INITIAL_OUTPUT_TIMEOUT) {
      logger.warn(
        `${logPrefix} WARNING: No output received after ${Math.floor(totalElapsed / 1000)}s`,
      );
      callbacks.onOutput(
        `\n[警告] ${Math.floor(totalElapsed / 1000)}秒経過しましたが、Gemini CLIからの応答がありません。処理を継続しています...\n`,
      );
      hasReceivedAnyOutput = true;
    }

    if (idleTime > OUTPUT_IDLE_TIMEOUT && lineBuffer.trim()) {
      logger.info(`${logPrefix} Holding partial stdout line while waiting for newline`);
    }

    if (idleTime > 10000) {
      logger.info(`${logPrefix} Still running... Output idle: ${Math.floor(idleTime / 1000)}s`);
    }
  }, 5000);

  const cleanupIdleCheck = () => clock.clearInterval(idleCheckInterval);

  const timeoutCheckInterval = clock.setInterval(() => {
    holdForSelfVerification();
    if (proc && !proc.killed) {
      const timeSinceLastOutput = clock.now() - lastOutputTime;

      if (timeSinceLastOutput >= timeout) {
        logger.info(`${logPrefix} TIMEOUT: No output for ${timeout / 1000}s`);
        clock.clearInterval(timeoutCheckInterval);
        cleanupIdleCheck();
        callbacks.onOutput(
          `\n${logPrefix} Execution timed out (no output for ${timeout / 1000}s)\n`,
          true,
        );
        proc.kill('SIGTERM');
        onStatusFailed();
      }
    }
  }, 10000);

  const cleanupTimeoutCheck = () => clock.clearInterval(timeoutCheckInterval);

  proc.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    lineBuffer += chunk;
    lastOutputTime = clock.now();

    if (!hasReceivedAnyOutput) {
      hasReceivedAnyOutput = true;
      const elapsedMs = Date.now() - startTime;
      logger.info(`${logPrefix} First stdout received after ${elapsedMs}ms`);
    }

    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      handleGeminiStreamLine(line, {
        config,
        logPrefix,
        activeTools,
        sessionState,
        detectedQuestionRef,
        callbacks,
      });
    }

    // Expose updated lineBuffer via a side-channel for the close handler
    (proc as NodeJS.EventEmitter & { _lineBuffer?: string })._lineBuffer = lineBuffer;
  });

  const checkGeminiQuotaSignal = createGeminiQuotaGuard(proc, logPrefix, callbacks);

  proc.stderr?.on('data', (data: Buffer) => {
    const output = data.toString();
    callbacks.onErrorBufferAppend(output);
    lastOutputTime = clock.now();
    logger.info(`${logPrefix} stderr: ${output.substring(0, 200)}`);

    // Inspect both stderr AND stdout — gemini-cli mixes retry messages
    // across both streams, and inter-stream chunking can split a single
    // line, so the detector runs on every chunk.
    checkGeminiQuotaSignal(output);

    const filtered = filterCliDiagnosticOutput(output, { provider: 'gemini' });
    if (filtered.display) {
      callbacks.onOutputBufferAppend(filtered.display);
      callbacks.onOutput(filtered.display, filtered.important);
    }
  });

  // Also watch stdout for the same signals — `Attempt N failed: ...`
  // sometimes lands there after gemini's JSON event stream is interrupted.
  proc.stdout?.on('data', (data: Buffer) => checkGeminiQuotaSignal(data.toString()));

  proc.on('close', (code: number | null) => {
    cleanupTimeoutCheck();
    cleanupIdleCheck();

    if (proc.pid) {
      const closedPid = proc.pid;
      unregisterProcess(closedPid);
      // On Windows, 'close' (stdio closed) does NOT guarantee the process
      // exited — mirrors claude-execution-runner.ts's same reap-after-grace.
      // killProcessTreeSafely refuses to touch a port-3001 (backend) process.
      // Capture descendants NOW, while the parent links are still live — a
      // command the agent launched can outlive both the agent and the shell
      // that started it, and is then unreachable from the root.
      const known = captureDescendants(closedPid);
      const reap = setTimeout(
        () => killProcessTreeSafely(closedPid, { knownTargets: known }),
        3000,
      );
      (reap as { unref?: () => void }).unref?.();
    }

    // Flush any remaining line buffer content
    const remaining = (proc as NodeJS.EventEmitter & { _lineBuffer?: string })._lineBuffer || '';
    if (remaining.trim()) {
      logger.info(`${logPrefix} Processing remaining lineBuffer: ${remaining.substring(0, 200)}`);
      if (!shouldHideRawCliLine(remaining)) {
        const displayLine = remaining.length > 240 ? `${remaining.slice(0, 237)}...` : remaining;
        callbacks.onOutputBufferAppend(displayLine + '\n');
        callbacks.onOutput(displayLine + '\n');
      }
    }

    const executionTimeMs = Date.now() - startTime;
    logger.info(`${logPrefix} Process closed with code: ${code}, time: ${executionTimeMs}ms`);

    // NOTE: Task 1582 — the CLI can exit while self-verification still runs;
    // resolve only after the verdict (bounded by the marker's 30-min limit) or
    // a stop request. onClose itself turns a cancelled status into cancelled.
    if (!reporter) {
      onClose(code);
      return;
    }
    reporter
      .waitUntilSettled({ isCancelled: selfVerification?.isCancelled ?? (() => false) })
      .catch((err) => logger.warn({ err }, `${logPrefix} self-verification wait failed`))
      .finally(() => onClose(code));
  });

  proc.on('error', (error: Error) => {
    cleanupTimeoutCheck();
    cleanupIdleCheck();
    logger.error({ err: error }, `${logPrefix} Process error`);
    callbacks.onOutput(`${logPrefix} Error: ${error.message}\n`, true);
    onStatusFailed();
  });

  return { cleanupIdleCheck, cleanupTimeoutCheck };
}
