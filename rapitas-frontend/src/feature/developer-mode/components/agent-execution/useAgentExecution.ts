/**
 * useAgentExecution
 *
 * Encapsulates all state and side effects for AgentExecutionPanel.
 * Event handlers are delegated to useAgentExecutionHandlers.
 * Types live in agentExecutionTypes; pure utilities in agentExecutionUtils.
 */

'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  useExecutionPolling,
  useExecutionStream,
} from '../../hooks/useExecutionStream';
import { useAgentExecutionHandlers } from './useAgentExecutionHandlers';
import { parseQuestionOptions } from './agent-execution-utils';
import type {
  UseAgentExecutionProps,
  UseAgentExecutionReturn,
  QuestionType,
  PrState,
} from './agent-execution-types';

// Re-export utilities and types consumed by external callers
export {
  formatTokenCount,
  formatCountdown,
  parseQuestionOptions,
} from './agent-execution-utils';
export type {
  PrState,
  QuestionType,
  UseAgentExecutionProps,
  UseAgentExecutionReturn,
} from './agent-execution-types';

/**
 * Core hook for AgentExecutionPanel state and side effects.
 *
 * @param props - Component props forwarded from AgentExecutionPanel
 * @returns All state values, derived flags, and event handlers needed by the panel
 */
export function useAgentExecution(
  props: UseAgentExecutionProps,
): UseAgentExecutionReturn {
  const {
    taskId,
    isExecuting,
    executionResult,
    error,
    agentConfigId,
    onExecute,
    onReset,
    onRestoreExecutionState,
    onStopExecution,
    onExecutionComplete,
    subtasks,
    parallelSessionId,
  } = props;

  const [isExpanded, setIsExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [_showLogs, _setShowLogs] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(
    agentConfigId ?? null,
  );
  const [instruction, setInstruction] = useState('');
  const [branchName, setBranchName] = useState('');
  const [userResponse, setUserResponse] = useState('');
  const [isSendingResponse, setIsSendingResponse] = useState(false);
  const [followUpInstruction, setFollowUpInstruction] = useState('');
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  // NOTE: Start as restoring=true when no execution result yet (initial page load).
  // This shows the skeleton loader until auto-restore in useDeveloperMode completes.
  const [isRestoring, setIsRestoring] = useState(
    !props.executionResult && props.executionStatus === 'idle',
  );
  const hasRestoredRef = useRef(false);
  const [timeoutCountdown, setTimeoutCountdown] = useState<number | null>(null);
  const [prState, setPrState] = useState<PrState>({ status: 'idle' });

  const {
    logs: sseLogs,
    status: sseStatus,
    isRunning: isSseRunning,
    isConnected: isSseConnected,
    error: sseError,
    clearLogs: clearSseLogs,
  } = useExecutionStream(sessionId);

  const {
    logs: pollingLogs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    questionType: pollingQuestionType,
    questionTimeout: pollingQuestionTimeout,
    sessionMode: pollingSessionMode,
    tokensUsed: pollingTokensUsed,
    startPolling,
    stopPolling,
    clearLogs: clearPollingLogs,
    setCancelled: setPollingCancelled,
    clearQuestion: clearPollingQuestion,
  } = useExecutionPolling(taskId);

  // Prefer SSE logs when connected; fall back to polling logs otherwise
  // NOTE: useMemo stabilizes the array reference to prevent unnecessary re-renders
  const logs = useMemo(
    () => (isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs),
    [isSseConnected, sseLogs, pollingLogs],
  );

  const isTerminalStatus =
    pollingStatus === 'completed' ||
    pollingStatus === 'failed' ||
    pollingStatus === 'cancelled' ||
    sseStatus === 'completed' ||
    sseStatus === 'failed' ||
    sseStatus === 'cancelled';

  // NOTE: Only explicit AI agent status is used; pattern matching is deprecated
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === 'waiting_for_input' || pollingWaitingForInput);

  // NOTE: Question detection uses only API state
  const { hasQuestion, question, questionType } = useMemo((): {
    hasQuestion: boolean;
    question: string;
    questionType: QuestionType;
  } => {
    if (!isTerminalStatus && pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        questionType:
          pollingQuestionType === 'tool_call' ? 'tool_call' : 'none',
      };
    }
    return { hasQuestion: false, question: '', questionType: 'none' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pollingWaitingForInput,
    pollingQuestion,
    pollingQuestionType,
    isTerminalStatus,
  ]);

  const questionParsed = question ? parseQuestionOptions(question) : null;
  const hasOptions = !!(questionParsed && questionParsed.options.length >= 2);
  const isConfirmedQuestion = questionType === 'tool_call';

  // Question timeout countdown
  useEffect(() => {
    if (!isWaitingForInput || !pollingQuestionTimeout) {
      setTimeoutCountdown(null);
      return;
    }
    setTimeoutCountdown(pollingQuestionTimeout.remainingSeconds);
    const interval = setInterval(() => {
      setTimeoutCountdown((prev) =>
        prev === null || prev <= 0 ? 0 : prev - 1,
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [isWaitingForInput, pollingQuestionTimeout]);

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
      _setShowLogs(true);
      setUserResponse('');
      setFollowUpInstruction('');
      setFollowUpError(null);
      setTimeoutCountdown(null);
      stopPolling();
      clearPollingLogs();
      clearSseLogs();
      previousTaskIdRef.current = taskId;
    }
  }, [taskId, stopPolling, clearPollingLogs, clearSseLogs]);

  // NOTE: Execution state restoration is handled solely by useDeveloperMode's auto-restore.
  // This hook only reacts to executionResult/executionStatus changes.

  // NOTE: Once execution result arrives (from any source), stop showing skeleton.
  // Also stop after 2 seconds max to handle "no execution history" case.
  useEffect(() => {
    if (executionResult !== null || props.executionStatus !== 'idle') {
      setIsRestoring(false);
      return;
    }
    const timeout = setTimeout(() => setIsRestoring(false), 2000);
    return () => clearTimeout(timeout);
  }, [executionResult, props.executionStatus]);

  // Start SSE + polling when a new execution result arrives
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;
  useEffect(() => {
    if (executionSessionId) {
      setSessionId(executionSessionId);
      startPolling(
        executionOutput
          ? { initialOutput: executionOutput, preserveLogs: false }
          : undefined,
      );
    }
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

  // Derived status flags
  const finalStatus =
    sseStatus !== 'idle'
      ? sseStatus
      : pollingStatus !== 'idle'
        ? pollingStatus
        : props.executionStatus;

  // NOTE: isRestoredTerminal is only true for the initial mount when restoring
  // a previously completed execution. Once a new execution starts (isExecuting becomes true),
  // the flag is permanently disabled for the rest of the component lifecycle.
  const hasExecutedRef = useRef(false);
  if (isExecuting) hasExecutedRef.current = true;
  const isRestoredTerminal =
    !hasExecutedRef.current &&
    executionResult?.success !== undefined &&
    !isExecuting;

  // NOTE: waiting_for_input is NOT considered completed
  // For restored terminal executions, derive status immediately from executionResult.
  const isCompleted =
    (finalStatus === 'completed' &&
      !isPollingRunning &&
      !isSseRunning &&
      !isWaitingForInput) ||
    (isRestoredTerminal && executionResult?.success === true);
  const isCancelled = finalStatus === 'cancelled';
  const isFailed =
    !!(finalStatus === 'failed' || error || pollingError || sseError) ||
    (isRestoredTerminal && executionResult?.success === false);
  const isRunning =
    !isRestoredTerminal &&
    (isExecuting ||
      isPollingRunning ||
      isSseRunning ||
      pollingStatus === 'running' ||
      sseStatus === 'running' ||
      isWaitingForInput);

  const hasSubtaskTabs = !!(
    subtasks &&
    subtasks.length > 0 &&
    parallelSessionId
  );

  const logViewerStatus = useMemo(() => {
    if (isRunning) return 'running' as const;
    if (isCancelled) return 'cancelled' as const;
    if (isCompleted) return 'completed' as const;
    if (isFailed) return 'failed' as const;
    return 'idle' as const;
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  const handlers = useAgentExecutionHandlers({
    taskId,
    sessionId,
    setSessionId,
    isExecuting,
    executionResult,
    instruction,
    branchName,
    selectedAgentId,
    agentConfigId,
    useTaskAnalysis: props.useTaskAnalysis,
    optimizedPrompt: props.optimizedPrompt,
    followUpInstruction,
    setFollowUpInstruction,
    setFollowUpError,
    userResponse,
    setUserResponse,
    isSendingResponse,
    setIsSendingResponse,
    onExecute,
    onReset,
    onStopExecution,
    startPolling,
    stopPolling,
    clearPollingLogs,
    clearSseLogs,
    setPollingCancelled,
    clearPollingQuestion,
    setPrState,
    hasRestoredRef,
    _setShowLogs,
  });

  return {
    isExpanded,
    setIsExpanded,
    showOptions,
    setShowOptions,
    selectedAgentId,
    setSelectedAgentId,
    instruction,
    setInstruction,
    branchName,
    setBranchName,
    userResponse,
    setUserResponse,
    isSendingResponse,
    followUpInstruction,
    setFollowUpInstruction,
    followUpError,
    setFollowUpError,
    sessionId,
    prState,
    setPrState,
    timeoutCountdown,
    logs,
    isSseConnected,
    pollingTokensUsed,
    pollingSessionMode,
    isRunning,
    isCompleted,
    isCancelled,
    isFailed,
    isRestoring,
    isWaitingForInput,
    logViewerStatus,
    hasQuestion,
    question,
    questionType,
    questionParsed,
    hasOptions,
    isConfirmedQuestion,
    hasSubtaskTabs,
    ...handlers,
  };
}
