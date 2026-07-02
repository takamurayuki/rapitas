/**
 * executionPollTerminal
 *
 * Handlers for the non-success terminal execution statuses — 'failed',
 * 'cancelled' and 'interrupted'. Each returns a state updater (or null to skip).
 * The 'completed' success path lives in the sibling completion module.
 */

import { type ExecutionStreamState, trimLogs } from './execution-stream-types';
import { logger, type PollRefs } from './execution-poll-shared';
import { defaultPollT, type PollTranslate } from './execution-poll-completion';

/**
 * Handle the 'failed' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @param t - Translator scoped to `devMode.executionPolling`. / `devMode.executionPolling` にスコープした翻訳関数
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleFailed(
  data: Record<string, unknown>,
  refs: PollRefs,
  t: PollTranslate = defaultPollT,
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

  const failedMessage = t('failedLog', {
    message: (data.errorMessage as string) || t('failedDefaultMessage'),
  });

  return (prev) => ({
    ...prev,
    isRunning: false,
    status: 'failed',
    waitingForInput: false,
    error: data.errorMessage as string | null,
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, `\n${failedMessage}\n`])
        : shouldAddLog
          ? [`${failedMessage}\n`]
          : prev.logs,
  });
}

/**
 * Handle the 'cancelled' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @param t - Translator scoped to `devMode.executionPolling`. / `devMode.executionPolling` にスコープした翻訳関数
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleCancelled(
  data: Record<string, unknown>,
  refs: PollRefs,
  t: PollTranslate = defaultPollT,
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

  // NOTE: Reuses the same `cancelledLog` key as useExecutionPolling's
  // setCancelled() so the immediate UI update and the polled confirmation
  // render identical text.
  const cancelledMessage = t('cancelledLog');

  return (prev) => ({
    ...prev,
    isRunning: false,
    status: 'cancelled',
    waitingForInput: false,
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, `\n${cancelledMessage}\n`])
        : shouldAddLog
          ? [`${cancelledMessage}\n`]
          : prev.logs,
  });
}

/**
 * Handle the 'interrupted' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @param t - Translator scoped to `devMode.executionPolling`. / `devMode.executionPolling` にスコープした翻訳関数
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleInterrupted(
  data: Record<string, unknown>,
  refs: PollRefs,
  t: PollTranslate = defaultPollT,
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

  const interruptedMessage = t('interruptedLog');

  return (prev) => ({
    ...prev,
    isRunning: false,
    status: 'failed',
    waitingForInput: false,
    error: (data.errorMessage as string) || t('interruptedDefaultError'),
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, `\n${interruptedMessage}\n`])
        : shouldAddLog
          ? [`${interruptedMessage}\n`]
          : prev.logs,
  });
}
