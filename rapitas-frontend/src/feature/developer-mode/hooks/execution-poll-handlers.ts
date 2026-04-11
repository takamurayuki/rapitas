/**
 * executionPollHandlers
 *
 * Pure status-dispatch functions for the execution polling loop.
 * Each handler processes a specific terminal or transitional execution status
 * and returns a partial state update (or null to skip the update).
 * Keeping these outside the hook avoids re-creating them on every render.
 */

import { createLogger } from '@/lib/logger';
import {
  type ExecutionStreamState,
  type QuestionTimeoutInfo,
  trimLogs,
} from './execution-stream-types';
import { API_BASE_URL } from '@/utils/api';

const logger = createLogger('ExecutionStream');

/** Workflow phase completion messages keyed by sessionMode */
const WORKFLOW_PHASE_LABELS: Record<string, string> = {
  'workflow-researcher':
    '[調査完了] リサーチフェーズが完了しました。次は計画フェーズを実行してください。',
  'workflow-planner':
    '[計画作成完了] 計画フェーズが完了しました。計画内容を確認し、承認してください。',
  'workflow-reviewer':
    '[レビュー完了] レビューフェーズが完了しました。計画内容を確認し、承認してください。',
  'workflow-implementer':
    '[実装完了] 実装フェーズが完了しました。検証フェーズを自動実行中...',
  'workflow-verifier':
    '[検証完了] 検証フェーズが完了しました。検証結果を確認し、問題なければタスクを完了にしてください。',
};

export type PollRefs = {
  lastProcessedStatusRef: React.MutableRefObject<string | null>;
  hasAddedFinalLogRef: React.MutableRefObject<boolean>;
  lastProcessedQuestionRef: React.MutableRefObject<string | null>;
  responseGraceUntilRef: React.MutableRefObject<number>;
  clearedQuestionRef: React.MutableRefObject<string | null>;
  terminalStatusGraceUntilRef: React.MutableRefObject<number>;
};

/**
 * Handle the 'completed' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleCompleted(
  data: Record<string, unknown>,
  refs: PollRefs,
): ((prev: ExecutionStreamState) => ExecutionStreamState) | null {
  const isStatusChanged =
    refs.lastProcessedStatusRef.current !== data.executionStatus;

  if (!isStatusChanged && refs.hasAddedFinalLogRef.current) {
    return null;
  }
  logger.info('Execution completed');
  refs.lastProcessedStatusRef.current = data.executionStatus as string;

  const shouldAddLog = !refs.hasAddedFinalLogRef.current;
  if (shouldAddLog) {
    refs.hasAddedFinalLogRef.current = true;
  }

  const sessionMode = data.sessionMode as string | null;
  let completionMessage = '\n[完了] 実行が完了しました。\n';
  if (sessionMode?.startsWith('workflow-')) {
    completionMessage =
      '\n' +
      (WORKFLOW_PHASE_LABELS[sessionMode] ||
        `[フェーズ完了] ${sessionMode}が完了しました。`) +
      '\n';
  }

  return (prev) => ({
    ...prev,
    isRunning: false,
    status: 'completed',
    waitingForInput: false,
    question: undefined,
    sessionMode: sessionMode || prev.sessionMode,
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, completionMessage])
        : shouldAddLog
          ? [completionMessage]
          : prev.logs,
  });
}

/**
 * Handle the 'failed' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleFailed(
  data: Record<string, unknown>,
  refs: PollRefs,
): ((prev: ExecutionStreamState) => ExecutionStreamState) | null {
  const isStatusChanged =
    refs.lastProcessedStatusRef.current !== data.executionStatus;

  if (!isStatusChanged && refs.hasAddedFinalLogRef.current) {
    return null;
  }

  // NOTE: During grace period after answer submission, a transient failure may
  // occur during session resume fallback, so don't treat as failed immediately
  const isInFailedGracePeriod = Date.now() < refs.responseGraceUntilRef.current;
  if (
    isInFailedGracePeriod &&
    refs.lastProcessedStatusRef.current === 'responding'
  ) {
    logger.debug(
      'Ignoring failed status during grace period (session fallback may be in progress)',
    );
    return null;
  }

  logger.info('Execution failed:', data.errorMessage);
  refs.lastProcessedStatusRef.current = data.executionStatus as string;

  const shouldAddLog = !refs.hasAddedFinalLogRef.current;
  if (shouldAddLog) {
    refs.hasAddedFinalLogRef.current = true;
  }

  return (prev) => ({
    ...prev,
    isRunning: false,
    status: 'failed',
    waitingForInput: false,
    error: data.errorMessage as string | null,
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([
            ...prev.logs,
            `\n[Error] ${(data.errorMessage as string) || 'Execution failed'}\n`,
          ])
        : shouldAddLog
          ? [`[Error] ${(data.errorMessage as string) || 'Execution failed'}\n`]
          : prev.logs,
  });
}

/**
 * Handle the 'cancelled' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleCancelled(
  data: Record<string, unknown>,
  refs: PollRefs,
): ((prev: ExecutionStreamState) => ExecutionStreamState) | null {
  const isStatusChanged =
    refs.lastProcessedStatusRef.current !== data.executionStatus;

  if (!isStatusChanged && refs.hasAddedFinalLogRef.current) {
    return null;
  }

  logger.info('Execution cancelled');
  refs.lastProcessedStatusRef.current = data.executionStatus as string;

  const shouldAddLog = !refs.hasAddedFinalLogRef.current;
  if (shouldAddLog) {
    refs.hasAddedFinalLogRef.current = true;
  }

  return (prev) => ({
    ...prev,
    isRunning: false,
    status: 'cancelled',
    waitingForInput: false,
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, '\n[キャンセル] 実行が停止されました。\n'])
        : shouldAddLog
          ? ['[キャンセル] 実行が停止されました。\n']
          : prev.logs,
  });
}

/**
 * Handle the 'interrupted' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleInterrupted(
  data: Record<string, unknown>,
  refs: PollRefs,
): ((prev: ExecutionStreamState) => ExecutionStreamState) | null {
  const isStatusChanged =
    refs.lastProcessedStatusRef.current !== data.executionStatus;

  if (!isStatusChanged && refs.hasAddedFinalLogRef.current) {
    return null;
  }

  // Skip during grace period after answer submission
  const isInInterruptedGracePeriod =
    Date.now() < refs.responseGraceUntilRef.current;
  if (
    isInInterruptedGracePeriod &&
    refs.lastProcessedStatusRef.current === 'responding'
  ) {
    logger.debug('Ignoring interrupted status during grace period');
    return null;
  }

  logger.info('Execution interrupted');
  refs.lastProcessedStatusRef.current = data.executionStatus as string;

  const shouldAddLog = !refs.hasAddedFinalLogRef.current;
  if (shouldAddLog) {
    refs.hasAddedFinalLogRef.current = true;
  }

  return (prev) => ({
    ...prev,
    isRunning: false,
    status: 'failed',
    waitingForInput: false,
    error: (data.errorMessage as string) || '実行が中断されました',
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, '\n[中断] 実行が中断されました。\n'])
        : shouldAddLog
          ? ['[中断] 実行が中断されました。\n']
          : prev.logs,
  });
}

// ─── Poll loop body ────────────────────────────────────────────────────────

type SetState = (
  updater:
    | ExecutionStreamState
    | ((prev: ExecutionStreamState) => ExecutionStreamState),
) => void;

/**
 * Execute a single poll iteration against the execution-status endpoint.
 * Mutates refs and calls setState/stopPolling as side effects.
 *
 * @param taskId - Task to poll / ポーリング対象タスクID
 * @param refs - Shared mutable refs / 共有可変ref群
 * @param lastOutputLengthRef - Tracks cursor in accumulated output / 累積出力のカーソル位置
 * @param setState - React state setter / ReactのsetState
 * @param stopPolling - Stop the polling interval / ポーリング停止関数
 */
export async function executePoll(
  taskId: number,
  refs: PollRefs,
  lastOutputLengthRef: React.MutableRefObject<number>,
  setState: SetState,
  stopPolling: () => void,
): Promise<void> {
  if (refs.lastProcessedStatusRef.current === 'cancelled') {
    logger.debug('Skipping poll - already cancelled');
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(
      `${API_BASE_URL}/tasks/${taskId}/execution-status`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (refs.lastProcessedStatusRef.current === 'cancelled') {
      logger.debug('Ignoring result - cancelled during fetch');
      return;
    }

    if (!res.ok) {
      logger.debug('Response not ok:', res.status);
      return;
    }

    const data = await res.json();

    if (!data.executionStatus || data.status === 'none') {
      logger.debug('No execution data yet');
      return;
    }

    // Always update token usage
    const polledTokensUsed = data.tokensUsed as number | undefined;
    const polledTotalSessionTokens = data.totalSessionTokens as
      | number
      | undefined;
    if (polledTokensUsed || polledTotalSessionTokens) {
      setState((prev) => ({
        ...prev,
        tokensUsed: polledTokensUsed ?? prev.tokensUsed,
        totalSessionTokens: polledTotalSessionTokens ?? prev.totalSessionTokens,
      }));
    }

    // Append new output diff
    if (data.output) {
      const currentLength = lastOutputLengthRef.current;
      const newOutput = (data.output as string).slice(currentLength);
      if (newOutput) {
        logger.debug('New output received:', newOutput.length, 'chars');
        lastOutputLengthRef.current = (data.output as string).length;
        setState((prev) => {
          const lastLog = prev.logs[prev.logs.length - 1];
          if (lastLog && lastLog === newOutput) {
            logger.debug('Skipping duplicate consecutive log entry');
            return prev;
          }
          return { ...prev, logs: trimLogs([...prev.logs, newOutput]) };
        });
      }
    }

    // NOTE: Absorb race after continuation: temporarily ignore terminal status
    if (
      refs.terminalStatusGraceUntilRef.current > 0 &&
      Date.now() < refs.terminalStatusGraceUntilRef.current &&
      (data.executionStatus === 'completed' ||
        data.executionStatus === 'failed' ||
        data.executionStatus === 'cancelled' ||
        data.executionStatus === 'interrupted')
    ) {
      setState((prev) => ({
        ...prev,
        isConnected: true,
        isRunning: true,
        status: 'running',
      }));
      return;
    }

    // Dispatch by status
    if (data.executionStatus === 'completed') {
      const updater = handleCompleted(data, refs);
      if (updater) {
        setState(updater);
        stopPolling();
      }
    } else if (data.executionStatus === 'failed') {
      const updater = handleFailed(data, refs);
      if (updater) {
        setState(updater);
        stopPolling();
      }
    } else if (data.executionStatus === 'cancelled') {
      const updater = handleCancelled(data, refs);
      if (updater) {
        setState(updater);
        stopPolling();
      }
    } else if (data.executionStatus === 'interrupted') {
      const updater = handleInterrupted(data, refs);
      if (updater) {
        setState(updater);
        stopPolling();
      }
    } else if (
      data.executionStatus === 'waiting_for_input' ||
      data.waitingForInput
    ) {
      if (refs.lastProcessedStatusRef.current === 'cancelled') return;

      // NOTE: Ignore waiting_for_input during grace period after answer submission
      const currentQuestion = (data.question as string) || '';
      const isInGracePeriod = Date.now() < refs.responseGraceUntilRef.current;
      if (
        isInGracePeriod &&
        (refs.lastProcessedStatusRef.current === 'responding' ||
          refs.lastProcessedStatusRef.current === 'running')
      ) {
        if (
          !currentQuestion ||
          refs.clearedQuestionRef.current === currentQuestion
        ) {
          logger.debug('Ignoring stale waiting_for_input during grace period');
          return;
        }
        logger.debug(
          'New question detected during grace period, allowing through',
        );
      }

      const isNewQuestion =
        refs.lastProcessedStatusRef.current !== 'waiting_for_input' ||
        refs.lastProcessedQuestionRef.current !== currentQuestion;

      const timeoutInfo: QuestionTimeoutInfo | undefined = data.questionTimeout
        ? {
            remainingSeconds: (
              data.questionTimeout as { remainingSeconds: number }
            ).remainingSeconds,
            deadline: (data.questionTimeout as { deadline: string }).deadline,
            totalSeconds: (data.questionTimeout as { totalSeconds: number })
              .totalSeconds,
          }
        : undefined;

      if (isNewQuestion) {
        logger.debug(
          'Waiting for input:',
          currentQuestion,
          'questionType:',
          data.questionType,
          'timeout:',
          timeoutInfo,
        );
        refs.lastProcessedStatusRef.current = 'waiting_for_input';
        refs.lastProcessedQuestionRef.current = currentQuestion;
        refs.responseGraceUntilRef.current = 0;
        refs.clearedQuestionRef.current = null;
      }

      setState((prev) => ({
        ...prev,
        isRunning: true,
        status: 'waiting_for_input',
        waitingForInput: true,
        question: currentQuestion,
        // NOTE: questionType uses API value only (pattern_match fallback removed)
        questionType: data.questionType === 'tool_call' ? 'tool_call' : 'none',
        questionTimeout: timeoutInfo,
        questionDetails:
          (data.questionDetails as ExecutionStreamState['questionDetails']) ||
          null,
      }));
    } else if (data.executionStatus === 'running') {
      if (refs.lastProcessedStatusRef.current === 'cancelled') return;
      if (refs.lastProcessedStatusRef.current === 'responding') {
        refs.lastProcessedStatusRef.current = 'running';
        // NOTE: Don't clear grace period — session resume fallback may still be in progress
      }
      setState((prev) => ({
        ...prev,
        isRunning: true,
        status: 'running',
      }));
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.debug('Request timed out, will retry');
      return;
    }
    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      logger.warn('Network error - backend may be unresponsive');
      return;
    }
    logger.error('Polling error:', error);
  }
}
