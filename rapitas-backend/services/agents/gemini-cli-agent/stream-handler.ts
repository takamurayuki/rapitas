/**
 * GeminiCliAgent — StreamHandler
 *
 * Processes the stdout line-by-line stream from the Gemini CLI process.
 * Handles JSON event parsing, question detection, idle monitoring, and timeout enforcement.
 * Not responsible for process spawning, prompt building, or artifact extraction.
 */

import type { ChildProcess } from 'child_process';
import type { GeminiStreamEvent } from './types';
import type { GeminiCliAgentConfig } from './types';
import {
  detectQuestionFromToolCall,
  createInitialWaitingState,
  updateWaitingStateFromDetection,
  tolegacyQuestionType,
} from '../question-detection';
import type { QuestionWaitingState } from '../question-detection';
import { parseStreamEvent, isNoiseLine } from './output-parser';
import { createLogger } from '../../../config/logger';
import { filterCliDiagnosticOutput, shouldHideRawCliLine } from '../cli-output-filter';

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
): { cleanupIdleCheck: () => void; cleanupTimeoutCheck: () => void } {
  const timeout = config.timeout ?? 900000;

  let lastOutputTime = Date.now();
  let hasReceivedAnyOutput = false;
  let lineBuffer = '';
  const OUTPUT_IDLE_TIMEOUT = 30000;
  const INITIAL_OUTPUT_TIMEOUT = 60000;

  const idleCheckInterval = setInterval(() => {
    const idleTime = Date.now() - lastOutputTime;
    const totalElapsed = Date.now() - startTime;

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

  const cleanupIdleCheck = () => clearInterval(idleCheckInterval);

  const timeoutCheckInterval = setInterval(() => {
    if (proc && !proc.killed) {
      const timeSinceLastOutput = Date.now() - lastOutputTime;

      if (timeSinceLastOutput >= timeout) {
        logger.info(`${logPrefix} TIMEOUT: No output for ${timeout / 1000}s`);
        clearInterval(timeoutCheckInterval);
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

  const cleanupTimeoutCheck = () => clearInterval(timeoutCheckInterval);

  proc.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    lineBuffer += chunk;
    lastOutputTime = Date.now();

    if (!hasReceivedAnyOutput) {
      hasReceivedAnyOutput = true;
      const elapsedMs = Date.now() - startTime;
      logger.info(`${logPrefix} First stdout received after ${elapsedMs}ms`);
    }

    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line) as GeminiStreamEvent;
        const timestamp = new Date().toISOString();
        logger.info(`${logPrefix} [${timestamp}] Event type: ${json.type}`);

        // Handle AskUserQuestion tool specially — pause and emit question
        if (json.type === 'assistant' && json.message?.content) {
          let questionHandled = false;
          for (const block of json.message.content) {
            if (
              block.type === 'tool_use' &&
              (block.name === 'AskUserQuestion' ||
                block.name === 'ask_user' ||
                block.name === 'ask')
            ) {
              logger.info(`${logPrefix} Question tool detected: ${block.name}`);

              const detectionResult = detectQuestionFromToolCall(
                'AskUserQuestion',
                block.input,
                config.timeout ? Math.floor(config.timeout / 1000) : undefined,
              );

              const newState = updateWaitingStateFromDetection(detectionResult);
              detectedQuestionRef.value = newState;

              callbacks.onQuestionDetected(newState);
              callbacks.onQuestionEmit({
                question: detectionResult.questionText,
                questionType: tolegacyQuestionType(newState.questionType),
                questionDetails: newState.questionDetails,
                questionKey: newState.questionKey,
              });

              const displayOutput = `\n[質問] ${detectionResult.questionText}\n`;
              callbacks.onOutputBufferAppend(displayOutput);
              callbacks.onOutput(displayOutput);

              // NOTE: Kill process to wait for user response before continuing
              logger.info(`${logPrefix} Stopping process to wait for user response`);
              callbacks.onKillProcess();
              questionHandled = true;
              break;
            }
          }
          if (questionHandled) continue;
        }

        const prevSessionId = sessionState.sessionId;
        const prevCheckpointId = sessionState.checkpointId;
        const displayOutput = parseStreamEvent(json, activeTools, sessionState);

        if (sessionState.sessionId !== prevSessionId) {
          logger.info(`${logPrefix} Session ID: ${sessionState.sessionId}`);
          if (sessionState.sessionId) callbacks.onSessionIdUpdate(sessionState.sessionId);
        }
        if (sessionState.checkpointId !== prevCheckpointId) {
          logger.info(`${logPrefix} Checkpoint ID: ${sessionState.checkpointId}`);
          if (sessionState.checkpointId) callbacks.onCheckpointIdUpdate(sessionState.checkpointId);
        }

        if (json.type === 'system' && (json.subtype === 'error' || json.error)) {
          logger.error({ systemError: json }, `${logPrefix} System error`);
        }

        if (displayOutput) {
          callbacks.onOutputBufferAppend(displayOutput);
          callbacks.onOutput(displayOutput);
        }
      } catch (e) {
        // NOTE: Filter non-JSON output (e.g., chcp command output on Windows)
        if (isNoiseLine(line)) {
          logger.info(`${logPrefix} Filtered non-JSON output: ${line.trim().substring(0, 100)}`);
          continue;
        }
        logger.info(`${logPrefix} Raw output: ${line.substring(0, 200)}`);
        if (!shouldHideRawCliLine(line)) {
          const displayLine = line.length > 240 ? `${line.slice(0, 237)}...` : line;
          callbacks.onOutputBufferAppend(displayLine + '\n');
          callbacks.onOutput(displayLine + '\n');
        }
      }
    }

    // Expose updated lineBuffer via a side-channel for the close handler
    (proc as NodeJS.EventEmitter & { _lineBuffer?: string })._lineBuffer = lineBuffer;
  });

  // Track gemini CLI's internal 429 retry loop. The CLI retries up to 10
  // times with exponential backoff before giving up — 5-7 minutes wasted.
  // Detect quota signals (any of the variants below) and short-circuit so
  // the orchestrator can fall back to claude/codex.
  //
  // Variants we have observed in real logs:
  //   `Attempt 1 failed with status 429. Retrying with backoff...`
  //   `Attempt 10 failed: No capacity available for model gemini-2.5-flash`
  //   `RetryableQuotaError: No capacity available...`
  //   `Quota exceeded for quota metric ...`
  //   bare `status: 429` in nested error chains
  // The previous detector only matched the first variant and was bypassed
  // when the chunk split mid-message or the first occurrence used variant 2.
  let geminiQuotaHits = 0;
  let geminiKillScheduled = false;
  const GEMINI_QUOTA_KILL_THRESHOLD = 2;
  const QUOTA_PATTERNS: RegExp[] = [
    /Attempt \d+ failed.*(429|status\s*429|No capacity)/i,
    /RetryableQuotaError|ResourceExhaustedError/i,
    /No capacity available for model/i,
    /Quota exceeded/i,
    /resource_exhausted/i,
    /Max attempts reached/i,
  ];

  function checkGeminiQuotaSignal(output: string): void {
    if (geminiKillScheduled || proc.killed) return;
    let hits = 0;
    for (const re of QUOTA_PATTERNS) {
      const m = output.match(new RegExp(re.source, re.flags + 'g'));
      if (m) hits += m.length;
    }
    if (hits === 0) return;
    geminiQuotaHits += hits;
    if (geminiQuotaHits < GEMINI_QUOTA_KILL_THRESHOLD) return;
    geminiKillScheduled = true;
    logger.warn(
      { logPrefix, hits: geminiQuotaHits },
      `Gemini hit quota/rate-limit signals (${geminiQuotaHits}× ≥ ${GEMINI_QUOTA_KILL_THRESHOLD}) — placing provider in cooldown and aborting CLI so orchestrator can fall back`,
    );
    callbacks.onOutput(
      `\n[Rapitas] Gemini API がレート/クオータ上限に達したためリトライを打ち切り、別プロバイダにフォールバックします。\n`,
      true,
    );
    import('../../ai/provider-cooldown')
      .then(({ markProviderCooldown }) => {
        markProviderCooldown('gemini', 'rate_limit', undefined, {
          message: 'gemini-cli quota / rate-limit signals detected',
        });
      })
      .catch(() => {});
    callbacks.onKillProcess();
  }

  proc.stderr?.on('data', (data: Buffer) => {
    const output = data.toString();
    callbacks.onErrorBufferAppend(output);
    lastOutputTime = Date.now();
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

    onClose(code);
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
