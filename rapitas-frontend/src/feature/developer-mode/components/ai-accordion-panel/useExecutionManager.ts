/**
 * useExecutionManager
 *
 * Orchestrates agent execution lifecycle: state restoration on mount, polling/SSE
 * log aggregation, branch-name generation, user-response submission, stop, reset,
 * rerun, and continue-execution flows.
 *
 * Does not render UI. All side-effects are self-contained.
 */

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import {
  useExecutionPolling,
  useExecutionStream,
} from '../../hooks/useExecutionStream';
import type {
  ExecutionResult,
  ExecutionStatus,
} from '../../hooks/useDeveloperMode';
import type { Resource } from '@/types';
import type { ExecutionLogStatus } from '../ExecutionLogViewer';
import type { AccordionSection } from './types';

const logger = createLogger('useExecutionManager');

type UseExecutionManagerOptions = {
  taskId: number;
  taskTitle: string;
  taskDescription?: string | null;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  executionError: string | null;
  optimizedPrompt?: string | null;
  agentConfigId?: number | null;
  resources?: Resource[];
  useTaskAnalysis?: boolean;
  subtasks?: { id: number; title: string }[];
  isParallelExecutionRunning?: boolean;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
    sessionId?: number;
    attachments?: Array<{
      id: number;
      title: string;
      type: string;
      fileName?: string;
      filePath?: string;
      mimeType?: string;
      description?: string;
    }>;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  onStopExecution?: () => void;
  onExecutionComplete?: () => void;
  onStartParallelExecution?: (config?: {
    maxConcurrentAgents?: number;
  }) => Promise<string | null>;
  setExpandedSection: (section: AccordionSection | null) => void;
};

type UseExecutionManagerResult = {
  // Log sources
  logs: string[];
  showLogs: boolean;
  setShowLogs: (v: boolean) => void;
  clearLogs: () => void;
  // Form fields
  instruction: string;
  setInstruction: (v: string) => void;
  branchName: string;
  setBranchName: (v: string) => void;
  isGeneratingBranchName: boolean;
  userResponse: string;
  setUserResponse: (v: string) => void;
  isSendingResponse: boolean;
  continueInstruction: string;
  setContinueInstruction: (v: string) => void;
  // Session / restore
  sessionId: number | null;
  isRestoring: boolean;
  // Execution status flags
  isRunning: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean | string | null | undefined;
  isInterrupted: boolean | string | null | undefined;
  isWaitingForInput: boolean | null | undefined;
  logViewerStatus: ExecutionLogStatus;
  hasQuestion: boolean;
  question: string;
  questionType: string;
  pollingSessionMode: string | null | undefined;
  isSseConnected: boolean;
  // Handlers
  handleExecute: () => Promise<void>;
  handleGenerateBranchName: () => Promise<void>;
  handleSendResponse: () => Promise<void>;
  handleStopExecution: () => Promise<void>;
  handleReset: () => void;
  handleRerunExecution: () => Promise<void>;
  handleContinueExecution: () => Promise<void>;
};

/**
 * Full execution lifecycle manager for the AI accordion panel.
 *
 * @param options - Props forwarded from the parent panel component.
 * @returns Derived state and event handlers consumed by ExecutionSection.
 */
export function useExecutionManager({
  taskId,
  taskTitle,
  taskDescription,
  isExecuting,
  executionResult,
  executionError,
  optimizedPrompt,
  agentConfigId,
  resources,
  useTaskAnalysis,
  subtasks,
  isParallelExecutionRunning,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
  onExecutionComplete,
  onStartParallelExecution,
  setExpandedSection,
}: UseExecutionManagerOptions): UseExecutionManagerResult {
  const { removeExecutingTask } = useExecutionStateStore();

  const [showLogs, setShowLogs] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [branchName, setBranchName] = useState('');
  const [isGeneratingBranchName, setIsGeneratingBranchName] = useState(false);
  const [userResponse, setUserResponse] = useState('');
  const [isSendingResponse, setIsSendingResponse] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  // NOTE: Start as true — show skeleton until execution state is restored from DB
  const [isRestoring, setIsRestoring] = useState(!executionResult);
  const [continueInstruction, setContinueInstruction] = useState('');
  const hasRestoredRef = useRef(false);
  const prevTaskIdRef = useRef(taskId);
  const sendingResponseRef = useRef(false);
  const handledTerminalStatusRef = useRef<string | null>(null);

  // SSE-based real-time log stream
  const {
    logs: sseLogs,
    status: sseStatus,
    isRunning: isSseRunning,
    isConnected: isSseConnected,
    error: sseError,
    clearLogs: clearSseLogs,
  } = useExecutionStream(sessionId);

  // Polling-based log retrieval (fallback / primary for older flows)
  const {
    logs: pollingLogs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    questionType: pollingQuestionType,
    sessionMode: pollingSessionMode,
    startPolling,
    stopPolling,
    clearLogs: clearPollingLogs,
    setCancelled: setPollingCancelled,
    clearQuestion: clearPollingQuestion,
  } = useExecutionPolling(taskId);

  // Prefer SSE logs when the connection is active; fall back to polling logs
  const logs = useMemo(() => {
    return isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs;
  }, [isSseConnected, sseLogs, pollingLogs]);

  const clearLogs = useCallback(() => {
    clearSseLogs();
    clearPollingLogs();
  }, [clearSseLogs, clearPollingLogs]);

  // Reset per-task state when the panel switches to a different task
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      hasRestoredRef.current = false;
      setSessionId(null);
      setIsRestoring(false);
      setContinueInstruction('');
      stopPolling();
      clearLogs();
    }
  }, [taskId, stopPolling, clearLogs]);

  // NOTE: Execution state restoration is handled by useDeveloperMode's auto-restore.
  // This hook only needs to react to executionResult changes (handled below).

  // NOTE: Stop showing skeleton once execution state is determined (from any source).
  // Timeout ensures "no history" case doesn't show skeleton forever.
  useEffect(() => {
    if (executionResult !== null || isExecuting) {
      setIsRestoring(false);
      return;
    }
    const timeout = setTimeout(() => setIsRestoring(false), 2000);
    return () => clearTimeout(timeout);
  }, [executionResult, isExecuting]);

  // Start polling when a new execution session arrives
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;

  useEffect(() => {
    if (isRestoring) return;
    // NOTE: Do not restart polling if pollingStatus is terminal — prevents infinite loop
    const isTerminalPolling =
      pollingStatus === 'completed' ||
      pollingStatus === 'failed' ||
      pollingStatus === 'cancelled';
    if (executionSessionId) {
      setSessionId(executionSessionId);
      if (!isPollingRunning && !isTerminalPolling) {
        if (executionOutput) {
          startPolling({
            initialOutput: executionOutput,
            preserveLogs: false,
            terminalGraceMs: 5000,
          });
        } else {
          startPolling({ terminalGraceMs: 5000 });
        }
      }
      setExpandedSection('execution');
    }
  }, [
    executionSessionId,
    executionOutput,
    startPolling,
    isRestoring,
    isPollingRunning,
    pollingStatus,
    setExpandedSection,
  ]);

  // Start polling when parent marks execution as running (no sessionId yet)
  useEffect(() => {
    const isTerminalPolling =
      pollingStatus === 'completed' ||
      pollingStatus === 'failed' ||
      pollingStatus === 'cancelled';
    if (
      isExecuting &&
      !isPollingRunning &&
      !isRestoring &&
      !isTerminalPolling
    ) {
      startPolling({ terminalGraceMs: 5000 });
    }
  }, [isExecuting, isPollingRunning, startPolling, isRestoring, pollingStatus]);

  // Notify parent once when polling reaches a terminal status
  useEffect(() => {
    if (handledTerminalStatusRef.current === pollingStatus) return;

    if (pollingStatus === 'completed') {
      handledTerminalStatusRef.current = pollingStatus;
      onExecutionComplete?.();
      removeExecutingTask(taskId);
    } else if (pollingStatus === 'failed' || pollingStatus === 'cancelled') {
      handledTerminalStatusRef.current = pollingStatus;
      onStopExecution?.();
      removeExecutingTask(taskId);
    } else {
      // Reset when returning to running / waiting_for_input
      handledTerminalStatusRef.current = null;
    }
  }, [
    pollingStatus,
    onStopExecution,
    onExecutionComplete,
    removeExecutingTask,
    taskId,
  ]);

  // Derived status flags
  const hasSubtasks = subtasks && subtasks.length > 0;

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

  // NOTE: executionResult.success being defined means the execution has already reached a terminal state.
  // In that case, polling is only running to fetch logs — not because the task is actively executing.
  const isRestoredTerminal =
    executionResult?.success !== undefined && !isExecuting;

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
    logs.length > 0 &&
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
      isWaitingForInput ||
      isParallelExecutionRunning);

  const logViewerStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return 'running';
    if (isCancelled) return 'cancelled';
    if (isCompleted) return 'completed';
    if (isFailed) return 'failed';
    return 'idle';
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  // Question detection — only from API status, not pattern matching
  const { hasQuestion, question, questionType } = useMemo(() => {
    if (pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        questionType:
          pollingQuestionType === 'tool_call' ? 'tool_call' : 'none',
      };
    }
    return { hasQuestion: false, question: '', questionType: 'none' as const };
  }, [pollingWaitingForInput, pollingQuestion, pollingQuestionType]);

  // Handlers

  const handleExecute = async () => {
    clearLogs();

    if (hasSubtasks && onStartParallelExecution) {
      const parallelId = await onStartParallelExecution();
      if (parallelId) {
        setShowLogs(true);
        setExpandedSection('execution');
      }
      return;
    }

    const fileResources = resources?.filter(
      (r) =>
        r.filePath ||
        r.type === 'file' ||
        r.type === 'image' ||
        r.type === 'pdf',
    );
    const attachments = fileResources?.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      fileName: r.fileName || undefined,
      filePath: r.filePath || undefined,
      mimeType: r.mimeType || undefined,
      description: r.description || undefined,
    }));

    const result = await onExecute({
      instruction: instruction.trim() || undefined,
      branchName: branchName.trim() || undefined,
      useTaskAnalysis,
      optimizedPrompt: optimizedPrompt || undefined,
      agentConfigId: agentConfigId ?? undefined,
      attachments:
        attachments && attachments.length > 0 ? attachments : undefined,
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  const handleGenerateBranchName = async () => {
    if (isGeneratingBranchName) return;

    setIsGeneratingBranchName(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/generate-branch-name`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription || undefined,
          }),
        },
      );

      const data = await res.json();
      if (res.ok) {
        if (data.branchName) {
          setBranchName(data.branchName);
        }
      } else {
        logger.error(
          'Failed to generate branch name:',
          data.error || data.details || 'Unknown error',
        );
      }
    } catch (error) {
      logger.error('Error generating branch name:', error);
    } finally {
      setIsGeneratingBranchName(false);
    }
  };

  const handleSendResponse = async () => {
    const trimmedResponse = userResponse.trim();
    if (!trimmedResponse || isSendingResponse || sendingResponseRef.current)
      return;

    // Immediately set ref to prevent duplicate submissions
    sendingResponseRef.current = true;
    setIsSendingResponse(true);

    const savedResponse = trimmedResponse;
    setUserResponse('');

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/agent-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: savedResponse }),
      });

      if (res.ok) {
        // Clear question UI after API confirms receipt
        clearPollingQuestion();
      } else {
        logger.error('Failed to send response:', res.status);
        // Restore response so the user can retry
        setUserResponse(savedResponse);
      }
    } catch (error) {
      logger.error('Error sending response:', error);
      setUserResponse(savedResponse);
    } finally {
      setIsSendingResponse(false);
      sendingResponseRef.current = false;
    }
  };

  const handleStopExecution = useCallback(async () => {
    setPollingCancelled();
    if (onStopExecution) onStopExecution();

    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        { method: 'POST' },
      );

      if (!res.ok && sessionId) {
        await fetch(`${API_BASE_URL}/agents/sessions/${sessionId}/stop`, {
          method: 'POST',
        });
      }
    } catch (error) {
      logger.error('Error stopping execution:', error);
    }
  }, [taskId, sessionId, setPollingCancelled, onStopExecution]);

  const handleReset = useCallback(() => {
    stopPolling();
    clearLogs();
    setSessionId(null);
    hasRestoredRef.current = false;
    setContinueInstruction('');
    onReset();
  }, [stopPolling, clearLogs, onReset]);

  const handleRerunExecution = async () => {
    handleReset();
    await handleExecute();
  };

  const handleContinueExecution = async () => {
    if (!continueInstruction.trim() || !sessionId) return;

    // Append previous execution tail as context for the continuation instruction
    const previousSummary = `\n【前回の実施内容】\n${logs.slice(-30).join('')}\n\n【追加指示】\n`;
    const fullInstruction = previousSummary + continueInstruction.trim();

    const result = await onExecute({
      instruction: fullInstruction,
      branchName: branchName.trim() || undefined,
      useTaskAnalysis: false, // Continuation does not use analysis results
      agentConfigId: agentConfigId ?? undefined,
      sessionId: sessionId,
    });

    if (result?.sessionId) {
      setContinueInstruction('');
      setShowLogs(true);
      setExpandedSection('execution');
      stopPolling();
      setSessionId(result.sessionId);
      // NOTE: preserveLogs=true keeps previous output visible; terminalGraceMs waits
      // for the backend to start processing the new continuation
      startPolling({ preserveLogs: true });
    }
  };

  return {
    logs,
    showLogs,
    setShowLogs,
    clearLogs,
    instruction,
    setInstruction,
    branchName,
    setBranchName,
    isGeneratingBranchName,
    userResponse,
    setUserResponse,
    isSendingResponse,
    continueInstruction,
    setContinueInstruction,
    sessionId,
    isRestoring,
    isRunning: !!isRunning,
    isCompleted,
    isCancelled,
    isFailed,
    isInterrupted,
    isWaitingForInput,
    logViewerStatus,
    hasQuestion,
    question,
    questionType,
    pollingSessionMode,
    isSseConnected,
    handleExecute,
    handleGenerateBranchName,
    handleSendResponse,
    handleStopExecution,
    handleReset,
    handleRerunExecution,
    handleContinueExecution,
  };
}
