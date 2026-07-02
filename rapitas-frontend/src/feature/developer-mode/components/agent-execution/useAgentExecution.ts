'use client';
// useAgentExecution

import { useState, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useExecutionPolling, useExecutionStream } from '../../hooks/useExecutionStream';
import { useAgentExecutionHandlers } from './useAgentExecutionHandlers';
import { useAgentExecutionQuestion } from './useAgentExecutionQuestion';
import { useAgentExecutionLifecycleEffects } from './useAgentExecutionLifecycleEffects';
import { computeStatusFlags } from './useAgentExecution.helpers';
import type {
  UseAgentExecutionProps,
  UseAgentExecutionReturn,
  PrState,
} from './agent-execution-types';

// Re-export utilities and types consumed by external callers
export { formatTokenCount, formatCountdown, parseQuestionOptions } from './agent-execution-utils';
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
export function useAgentExecution(props: UseAgentExecutionProps): UseAgentExecutionReturn {
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

  const tQuestionOptions = useTranslations('devMode.parseQuestionOptions');
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [_showLogs, _setShowLogs] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(agentConfigId ?? null);
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
    questionDetails: pollingQuestionDetails,
    sessionMode: pollingSessionMode,
    tokensUsed: pollingTokensUsed,
    phaseAdvanceMarker: pollingPhaseAdvanceMarker,
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
    !isTerminalStatus && (pollingStatus === 'waiting_for_input' || pollingWaitingForInput);

  const {
    hasQuestion,
    question,
    questionType,
    questionParsed,
    hasOptions,
    isConfirmedQuestion,
    timeoutCountdown,
    resetTimeoutCountdown,
  } = useAgentExecutionQuestion({
    taskId,
    sessionId,
    isTerminalStatus,
    isWaitingForInput: isWaitingForInput ?? false,
    pollingWaitingForInput,
    pollingQuestion,
    pollingQuestionType,
    pollingQuestionDetails,
    pollingQuestionTimeout,
    tQuestionOptions,
  });

  useAgentExecutionLifecycleEffects({
    taskId,
    isExecuting,
    executionResult,
    executionStatus: props.executionStatus,
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
    setShowLogs: _setShowLogs,
    setUserResponse,
    setFollowUpInstruction,
    setFollowUpError,
    resetTimeoutCountdown,
  });

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
    !hasExecutedRef.current && executionResult?.success !== undefined && !isExecuting;

  // Compute all status flags using helper
  const { isCompleted, isCancelled, isFailed, isRunning } = computeStatusFlags({
    finalStatus,
    isPollingRunning,
    isSseRunning,
    isWaitingForInput: isWaitingForInput ?? false,
    isRestoredTerminal,
    executionResult,
    isExecuting,
    pollingStatus,
    sseStatus,
    error,
    pollingError,
    sseError,
  });

  const hasSubtaskTabs = !!(subtasks && subtasks.length > 0 && parallelSessionId);

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
    pollingSessionMode: pollingSessionMode ?? undefined,
    isRunning: isRunning ?? false,
    isCompleted: isCompleted ?? false,
    isCancelled: isCancelled ?? false,
    isFailed,
    isRestoring,
    isWaitingForInput: isWaitingForInput ?? false,
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
