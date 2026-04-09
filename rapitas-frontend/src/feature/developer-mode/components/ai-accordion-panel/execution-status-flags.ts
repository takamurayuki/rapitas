/**
 * execution-status-flags
 *
 * Pure derivation of the boolean status flags consumed by the agent
 * execution UI (running / completed / cancelled / failed / interrupted /
 * waiting-for-input). Extracted from useExecutionManager so the hook body
 * stays under the per-file size limit; the logic itself has no state
 * dependencies and can be unit-tested in isolation.
 */
import type { ExecutionResult } from '../../hooks/useDeveloperMode';
import type { ExecutionLogStatus } from '../ExecutionLogViewer';

/** Inputs to the status-flag derivation. */
export interface ExecutionStatusFlagInput {
  pollingStatus: string;
  sseStatus: string;
  pollingWaitingForInput: boolean | null | undefined;
  pollingError: string | null | undefined;
  sseError: string | null | undefined;
  executionError: string | null;
  executionResult: ExecutionResult | null;
  isExecuting: boolean;
  isPollingRunning: boolean;
  isSseRunning: boolean;
  isParallelExecutionRunning: boolean | undefined;
  isRestoredTerminal: boolean;
  logsLength: number;
}

/** Output flags consumed by the panel UI. */
export interface ExecutionStatusFlags {
  isTerminalStatus: boolean;
  isWaitingForInput: boolean | null | undefined;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean | string | null | undefined;
  isInterrupted: boolean | string | null | undefined;
  isRunning: boolean;
  finalStatus: string;
}

/**
 * Derive the full status-flag bundle from raw polling/SSE/execution state.
 *
 * Pure function — no React, no refs, no side effects. Safe to memoize at
 * the call site.
 */
export function deriveExecutionStatusFlags(
  input: ExecutionStatusFlagInput,
): ExecutionStatusFlags {
  const {
    pollingStatus,
    sseStatus,
    pollingWaitingForInput,
    pollingError,
    sseError,
    executionError,
    executionResult,
    isExecuting,
    isPollingRunning,
    isSseRunning,
    isParallelExecutionRunning,
    isRestoredTerminal,
    logsLength,
  } = input;

  const isTerminalStatus =
    pollingStatus === 'completed' ||
    pollingStatus === 'failed' ||
    pollingStatus === 'cancelled' ||
    sseStatus === 'completed' ||
    sseStatus === 'failed' ||
    sseStatus === 'cancelled';

  // NOTE: Only uses explicit DB status (waitingForInput). Legacy pattern-matching removed.
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === 'waiting_for_input' || pollingWaitingForInput);

  const finalStatus =
    sseStatus !== 'idle'
      ? sseStatus
      : pollingStatus !== 'idle'
        ? pollingStatus
        : 'idle';

  // NOTE: For restored terminal executions, derive status from executionResult immediately
  // rather than waiting for polling, to avoid the blank/idle flash.
  const isCompleted =
    (finalStatus === 'completed' && !isWaitingForInput) ||
    (isRestoredTerminal && executionResult?.success === true);
  const isCancelled = finalStatus === 'cancelled';
  const isFailed =
    (!isCompleted &&
      (finalStatus === 'failed' ||
        executionError ||
        pollingError ||
        sseError)) ||
    (isRestoredTerminal && executionResult?.success === false);
  const isInterrupted =
    !isCompleted &&
    !isFailed &&
    !isCancelled &&
    executionResult?.output &&
    logsLength > 0 &&
    !isExecuting &&
    !isPollingRunning &&
    !isSseRunning &&
    finalStatus === 'idle';
  const isRunning =
    !isTerminalStatus &&
    !isInterrupted &&
    !isRestoredTerminal &&
    (isExecuting ||
      isPollingRunning ||
      isSseRunning ||
      pollingStatus === 'running' ||
      sseStatus === 'running' ||
      !!isWaitingForInput ||
      !!isParallelExecutionRunning);

  return {
    isTerminalStatus,
    isWaitingForInput,
    isCompleted,
    isCancelled,
    isFailed,
    isInterrupted,
    isRunning,
    finalStatus,
  };
}

/** Map the boolean flag bundle into a single ExecutionLogStatus. */
export function deriveLogViewerStatus(
  flags: Pick<
    ExecutionStatusFlags,
    'isRunning' | 'isCancelled' | 'isCompleted' | 'isFailed'
  >,
): ExecutionLogStatus {
  if (flags.isRunning) return 'running';
  if (flags.isCancelled) return 'cancelled';
  if (flags.isCompleted) return 'completed';
  if (flags.isFailed) return 'failed';
  return 'idle';
}
