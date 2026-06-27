/**
 * executionPollTerminal
 *
 * Handlers for the non-success terminal execution statuses — 'failed',
 * 'cancelled' and 'interrupted'. Each returns a state updater (or null to skip).
 * The 'completed' success path lives in the sibling completion module.
 */

import { type ExecutionStreamState, trimLogs } from './execution-stream-types';
import { logger, type PollRefs } from './execution-poll-shared';

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
  const isStatusChanged = refs.lastProcessedStatusRef.current !== data.executionStatus;

  if (!isStatusChanged && refs.hasAddedFinalLogRef.current) {
    return null;
  }

  // NOTE: During grace period after answer submission, a transient failure may
  // occur during session resume fallback, so don't treat as failed immediately
  const isInFailedGracePeriod = Date.now() < refs.responseGraceUntilRef.current;
  if (isInFailedGracePeriod && refs.lastProcessedStatusRef.current === 'responding') {
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
  const isStatusChanged = refs.lastProcessedStatusRef.current !== data.executionStatus;

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
  const isStatusChanged = refs.lastProcessedStatusRef.current !== data.executionStatus;

  if (!isStatusChanged && refs.hasAddedFinalLogRef.current) {
    return null;
  }

  // Skip during grace period after answer submission
  const isInInterruptedGracePeriod = Date.now() < refs.responseGraceUntilRef.current;
  if (isInInterruptedGracePeriod && refs.lastProcessedStatusRef.current === 'responding') {
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
