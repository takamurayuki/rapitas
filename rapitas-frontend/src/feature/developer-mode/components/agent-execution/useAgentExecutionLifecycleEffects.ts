/**
 * useAgentExecutionLifecycleEffects
 *
 * Side-effect-only hook that owns the task-change reset, restore-skeleton
 * timeout, SSE/polling-start, and terminal/phase-advance notification
 * effects for useAgentExecution. Extracted from the hook file to keep it
 * under the size limit; behavior (including effect dependency arrays) is
 * unchanged.
 */
import { useEffect, useRef } from 'react';
import type { useExecutionPolling, useExecutionStream } from '../../hooks/useExecutionStream';
import type { ExecutionResult, ExecutionStatus } from '../../hooks/useDeveloperMode';

type PollingApi = ReturnType<typeof useExecutionPolling>;
type StreamApi = ReturnType<typeof useExecutionStream>;

export interface UseAgentExecutionLifecycleEffectsArgs {
  taskId: number;
  isExecuting: boolean;
  executionResult: ExecutionResult | null;
  executionStatus: ExecutionStatus;
  onExecutionComplete?: () => void;
  pollingStatus: PollingApi['status'];
  pollingPhaseAdvanceMarker: PollingApi['phaseAdvanceMarker'];
  isPollingRunning: PollingApi['isRunning'];
  startPolling: PollingApi['startPolling'];
  stopPolling: PollingApi['stopPolling'];
  clearPollingLogs: PollingApi['clearLogs'];
  clearSseLogs: StreamApi['clearLogs'];
  hasRestoredRef: React.MutableRefObject<boolean>;
  setIsExpanded: (v: boolean) => void;
  setSessionId: (v: number | null) => void;
  setIsRestoring: (v: boolean) => void;
  setShowLogs: (v: boolean) => void;
  setUserResponse: (v: string) => void;
  setFollowUpInstruction: (v: string) => void;
  setFollowUpError: (v: string | null) => void;
  resetTimeoutCountdown: () => void;
}

/**
 * Wires up all of useAgentExecution's non-question side effects: resetting
 * local state on task change, the restore-skeleton timeout, starting SSE +
 * polling when a new execution result/start arrives, and notifying the
 * parent once when polling reaches a terminal status or a workflow phase
 * advances.
 *
 * @param args - state, setters, and callbacks needed by the effects / エフェクトに必要な状態・セッター・コールバック
 */
export function useAgentExecutionLifecycleEffects(
  args: UseAgentExecutionLifecycleEffectsArgs,
): void {
  const {
    taskId,
    isExecuting,
    executionResult,
    executionStatus,
    onExecutionComplete,
    pollingStatus,
    pollingPhaseAdvanceMarker,
    isPollingRunning,
    startPolling,
    stopPolling,
    clearPollingLogs,
    clearSseLogs,
    hasRestoredRef,
    setIsExpanded,
    setSessionId,
    setIsRestoring,
    setShowLogs,
    setUserResponse,
    setFollowUpInstruction,
    setFollowUpError,
    resetTimeoutCountdown,
  } = args;

  // Reset all local state when the displayed task changes
  const previousTaskIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (previousTaskIdRef.current === null) {
      previousTaskIdRef.current = taskId;
      return;
    }
    if (previousTaskIdRef.current !== taskId) {
      hasRestoredRef.current = false;
      setIsExpanded(false);
      setSessionId(null);
      setIsRestoring(false);
      setShowLogs(true);
      setUserResponse('');
      setFollowUpInstruction('');
      setFollowUpError(null);
      resetTimeoutCountdown();
      stopPolling();
      clearPollingLogs();
      clearSseLogs();
      previousTaskIdRef.current = taskId;
    }
    // NOTE: Setter functions (setIsExpanded/setSessionId/etc.) are stable React
    // dispatchers from the parent hook; omitted intentionally to match the
    // original inline-effect's dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, stopPolling, clearPollingLogs, clearSseLogs]);

  // NOTE: Execution state restoration is handled solely by useDeveloperMode's auto-restore.
  // This hook only reacts to executionResult/executionStatus changes.

  // NOTE: Once execution result arrives (from any source), stop showing skeleton.
  // Also stop after 2 seconds max to handle "no execution history" case.
  useEffect(() => {
    if (executionResult !== null || executionStatus !== 'idle') {
      setIsRestoring(false);
      return;
    }
    const timeout = setTimeout(() => setIsRestoring(false), 2000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setIsRestoring is a stable dispatcher
  }, [executionResult, executionStatus]);

  // Start SSE + polling when a new execution result arrives
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;
  useEffect(() => {
    if (executionSessionId) {
      setSessionId(executionSessionId);
      startPolling(
        executionOutput ? { initialOutput: executionOutput, preserveLogs: false } : undefined,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSessionId is a stable dispatcher
  }, [executionSessionId, executionOutput, startPolling]);

  // Start polling when execution begins
  useEffect(() => {
    if (isExecuting && !isPollingRunning) startPolling();
  }, [isExecuting, isPollingRunning, startPolling]);

  // Notify parent once when polling reaches a terminal state
  const handledTerminalStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (handledTerminalStatusRef.current === pollingStatus) return;
    if (['completed', 'failed', 'cancelled'].includes(pollingStatus)) {
      handledTerminalStatusRef.current = pollingStatus;
      onExecutionComplete?.();
    } else {
      handledTerminalStatusRef.current = null;
    }
  }, [pollingStatus, onExecutionComplete]);

  // Also notify on PHASE rollover / completion within an auto-advancing
  // workflow (researcher → planner → ...). Without this, my earlier fix
  // that keeps `pollingStatus = 'running'` between phases prevented the
  // terminal-state effect above from firing, so the workflow status
  // indicator + file tabs went stale until the user reloaded the page.
  // The `phaseAdvanceMarker` increments on each phase boundary; that
  // increment is what we react to. The marker is monotonically growing,
  // so we only fire when it actually changes.
  const handledPhaseMarkerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof pollingPhaseAdvanceMarker !== 'number') return;
    if (handledPhaseMarkerRef.current === pollingPhaseAdvanceMarker) return;
    handledPhaseMarkerRef.current = pollingPhaseAdvanceMarker;
    if (pollingPhaseAdvanceMarker > 0) {
      onExecutionComplete?.();
    }
  }, [pollingPhaseAdvanceMarker, onExecutionComplete]);
}
