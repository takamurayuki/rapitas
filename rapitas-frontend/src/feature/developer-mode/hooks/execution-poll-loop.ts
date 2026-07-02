/**
 * executionPollLoop
 *
 * The single-iteration poll loop body for the execution-status endpoint.
 * Fetches the latest status, applies output/token diffs and dispatches the
 * raw status to the completion/terminal handlers. Does NOT own the polling
 * interval — callers schedule and stop it.
 */

import {
  type ExecutionStreamState,
  type QuestionTimeoutInfo,
  trimLogs,
} from './execution-stream-types';
import { API_BASE_URL } from '@/utils/api';
import { logger, type PollRefs } from './execution-poll-shared';
import {
  handleCompleted,
  shouldKeepPollingAfterCompleted,
  defaultPollT,
  type PollTranslate,
} from './execution-poll-completion';
import { handleFailed, handleCancelled, handleInterrupted } from './execution-poll-terminal';

type SetState = (
  updater: ExecutionStreamState | ((prev: ExecutionStreamState) => ExecutionStreamState),
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
 * @param t - Translator scoped to `devMode.executionPolling`, forwarded to the status handlers. / `devMode.executionPolling` にスコープした翻訳関数
 */
export async function executePoll(
  taskId: number,
  refs: PollRefs,
  lastOutputLengthRef: React.MutableRefObject<number>,
  setState: SetState,
  stopPolling: () => void,
  t: PollTranslate = defaultPollT,
): Promise<void> {
  if (refs.lastProcessedStatusRef.current === 'cancelled') {
    logger.debug('Skipping poll - already cancelled');
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const outputOffset = Math.max(0, lastOutputLengthRef.current);
    const res = await fetch(
      `${API_BASE_URL}/tasks/${taskId}/execution-status?outputOffset=${outputOffset}`,
      {
        signal: controller.signal,
      },
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

    // Detect a phase rollover: orchestrator advanced to a new phase
    // (researcher → planner → ... → verifier) which spawned a NEW
    // AgentExecution row. Reset the output cursor and the "final log
    // emitted" flag so the new phase's logs surface immediately, while
    // keeping the accumulated UI logs (so the user sees the whole
    // task's history in one scroll).
    const newExecutionId =
      typeof data.executionId === 'number' ? (data.executionId as number) : null;
    if (
      newExecutionId !== null &&
      refs.lastExecutionIdRef.current !== null &&
      newExecutionId !== refs.lastExecutionIdRef.current
    ) {
      logger.info(
        'Phase rollover detected: new executionId',
        newExecutionId,
        'replacing',
        refs.lastExecutionIdRef.current,
      );
      lastOutputLengthRef.current = 0;
      refs.lastProcessedStatusRef.current = null;
      refs.hasAddedFinalLogRef.current = false;
      refs.lastProcessedQuestionRef.current = null;
      // Bump phase advance marker — parents refetch workflow files /
      // status indicator on the seam.
      setState((prev) => ({
        ...prev,
        phaseAdvanceMarker: (prev.phaseAdvanceMarker ?? 0) + 1,
      }));
    }
    if (newExecutionId !== null) {
      refs.lastExecutionIdRef.current = newExecutionId;
    }

    // Always update token usage
    const polledTokensUsed = data.tokensUsed as number | undefined;
    const polledTotalSessionTokens = data.totalSessionTokens as number | undefined;
    if (polledTokensUsed || polledTotalSessionTokens) {
      setState((prev) => {
        const nextTokensUsed = polledTokensUsed ?? prev.tokensUsed;
        const nextTotalSessionTokens = polledTotalSessionTokens ?? prev.totalSessionTokens;
        if (
          prev.tokensUsed === nextTokensUsed &&
          prev.totalSessionTokens === nextTotalSessionTokens
        ) {
          return prev;
        }
        return {
          ...prev,
          tokensUsed: nextTokensUsed,
          totalSessionTokens: nextTotalSessionTokens,
        };
      });
    }

    // Keep sessionMode current on EVERY poll. handleCompleted only sets it on a
    // terminal row, but the UI needs it during running phases too so it can tell
    // a multi-phase workflow run (use the cross-phase polling log) from a single
    // execution (use real-time SSE).
    if (typeof data.sessionMode === 'string') {
      const mode = data.sessionMode as string;
      setState((prev) => (prev.sessionMode === mode ? prev : { ...prev, sessionMode: mode }));
    }

    // Append new output diff
    if (typeof data.outputLength === 'number') {
      const nextOutputLength = Math.max(0, data.outputLength as number);
      if (nextOutputLength < lastOutputLengthRef.current) {
        lastOutputLengthRef.current = nextOutputLength;
      }
    }

    if (data.output) {
      const currentLength = lastOutputLengthRef.current;
      const newOutput = data.output as string;
      if (newOutput) {
        logger.debug('New output received:', newOutput.length, 'chars');
        lastOutputLengthRef.current =
          typeof data.outputLength === 'number'
            ? Math.max(currentLength + newOutput.length, data.outputLength as number)
            : currentLength + newOutput.length;
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
      const updater = handleCompleted(data, refs, t);
      if (updater) {
        setState(updater);
        // Only stop polling when the task as a whole is done. For
        // auto-advancing workflow phases, keep polling so the next phase's
        // execution row is picked up the moment it appears.
        if (!shouldKeepPollingAfterCompleted(data)) {
          stopPolling();
        }
      }
    } else if (data.executionStatus === 'failed') {
      const updater = handleFailed(data, refs, t);
      if (updater) {
        setState(updater);
        stopPolling();
      }
    } else if (data.executionStatus === 'cancelled') {
      const updater = handleCancelled(data, refs, t);
      if (updater) {
        setState(updater);
        stopPolling();
      }
    } else if (data.executionStatus === 'interrupted') {
      const updater = handleInterrupted(data, refs, t);
      if (updater) {
        setState(updater);
        stopPolling();
      }
    } else if (data.executionStatus === 'waiting_for_input' || data.waitingForInput) {
      if (refs.lastProcessedStatusRef.current === 'cancelled') return;

      // NOTE: Ignore waiting_for_input during grace period after answer submission
      const currentQuestion = (data.question as string) || '';
      const isInGracePeriod = Date.now() < refs.responseGraceUntilRef.current;
      if (
        isInGracePeriod &&
        (refs.lastProcessedStatusRef.current === 'responding' ||
          refs.lastProcessedStatusRef.current === 'running')
      ) {
        if (!currentQuestion || refs.clearedQuestionRef.current === currentQuestion) {
          logger.debug('Ignoring stale waiting_for_input during grace period');
          return;
        }
        logger.debug('New question detected during grace period, allowing through');
      }

      const isNewQuestion =
        refs.lastProcessedStatusRef.current !== 'waiting_for_input' ||
        refs.lastProcessedQuestionRef.current !== currentQuestion;

      const timeoutInfo: QuestionTimeoutInfo | undefined = data.questionTimeout
        ? {
            remainingSeconds: (data.questionTimeout as { remainingSeconds: number })
              .remainingSeconds,
            deadline: (data.questionTimeout as { deadline: string }).deadline,
            totalSeconds: (data.questionTimeout as { totalSeconds: number }).totalSeconds,
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
        questionDetails: (data.questionDetails as ExecutionStreamState['questionDetails']) || null,
      }));
    } else if (data.executionStatus === 'running') {
      if (refs.lastProcessedStatusRef.current === 'cancelled') return;
      if (refs.lastProcessedStatusRef.current === 'responding') {
        refs.lastProcessedStatusRef.current = 'running';
        // NOTE: Don't clear grace period — session resume fallback may still be in progress
      }
      setState((prev) =>
        prev.isRunning && prev.status === 'running'
          ? prev
          : {
              ...prev,
              isRunning: true,
              status: 'running',
            },
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.debug('Request timed out, will retry');
      return;
    }
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      logger.warn('Network error - backend may be unresponsive');
      return;
    }
    logger.error('Polling error:', error);
  }
}
