'use client';
// useDeveloperMode

import { useState, useRef, useEffect } from 'react';
import type { ExecutionStatus, ExecutionResult } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { createLogger } from '@/lib/logger';
import { useDeveloperModeConfig } from './useDeveloperModeConfig';
import { useAgentExecutionActions } from './useAgentExecutionActions';

const logger = createLogger('useDeveloperMode');

export type { ExecutionStatus, ExecutionResult };

export function useDeveloperMode(taskId: number) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  /** True while fetching execution state from DB on initial load. */
  const [isRestoringState, setIsRestoringState] = useState(true);

  const { setExecutingTask, setTaskLoaded } = useExecutionStateStore();
  const hasAutoRestoredRef = useRef(false);

  // Reset execution state when navigating to a different task
  const prevTaskIdRef = useRef(taskId);
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      // NOTE: Resetting isExecuting and status here prevents stale state from
      // a previous task leaking into the newly opened task detail view.
      setIsExecuting(false);
      setExecutionStatus('idle');
      setExecutionResult(null);
      setIsRestoringState(true);
      // NOTE: Reset auto-restore flag so the new task's state is restored
      hasAutoRestoredRef.current = false;
    }
  }, [taskId]);

  const {
    config,
    isLoading,
    isAnalyzing,
    analysisResult,
    analysisApprovalId,
    sessions,
    error,
    analysisError,
    agentConfigId,
    agents,
    setAnalysisResult,
    setAgentConfigId,
    setError,
    fetchConfig,
    enableDeveloperMode,
    disableDeveloperMode,
    updateConfig,
    analyzeTask,
    fetchSessions,
    approveSubtaskCreation,
    fetchAgents,
  } = useDeveloperModeConfig(taskId);

  const { executeAgent, stopExecution, resetExecutionState, setExecutionCancelled } =
    useAgentExecutionActions(taskId, agentConfigId, {
      setIsExecuting,
      setExecutionStatus,
      setExecutionResult,
      setError,
    });

  // NOTE: Auto-restore execution state on mount so the execution panel is visible
  // immediately without requiring a page reload. The ref prevents duplicate calls.
  useEffect(() => {
    if (hasAutoRestoredRef.current || !taskId) return;
    hasAutoRestoredRef.current = true;
    setIsRestoringState(true);

    restoreExecutionState()
      .then((restored) => {
        if (restored) {
          logger.debug(
            `[useDeveloperMode] Auto-restored execution state for task ${taskId}: ${restored.status}`,
          );
        }
      })
      .catch(() => {})
      .finally(() => {
        setIsRestoringState(false);
        // NOTE: Clear skeleton. isCompleted/isFailed are now derived directly from
        // executionResult.success (via isRestoredTerminal), so no polling wait needed.
        setTaskLoaded(taskId);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  /**
   * Restore in-progress execution state on mount.
   * Fetches persisted log output from DB so execution history survives app restarts.
   *
   * @returns Restored state snapshot or null when no active execution exists
   */
  const restoreExecutionState = async () => {
    try {
      const statusRes = await fetch(`${API_BASE_URL}/tasks/${taskId}/execution-status`);
      if (!statusRes.ok) return null;

      const statusData = await statusRes.json();

      if (!statusData.executionStatus || statusData.status === 'none') {
        return null;
      }

      const isActive =
        statusData.executionStatus === 'running' ||
        statusData.executionStatus === 'waiting_for_input' ||
        statusData.executionStatus === 'interrupted' ||
        statusData.executionStatus === 'completed' ||
        statusData.executionStatus === 'failed';

      if (!isActive) return null;

      // NOTE: statusData.output contains the full output including the initial
      // "[実行開始]" message, while AgentExecutionLog chunks only contain streaming
      // output. Use statusData.output as primary source to preserve the initial message.
      let fullOutput = statusData.output || '';
      if (!fullOutput) {
        try {
          const logsRes = await fetch(`${API_BASE_URL}/tasks/${taskId}/execution-logs`);
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            if (logsData.logs?.length > 0) {
              fullOutput = logsData.logs.map((log: { chunk: string }) => log.chunk).join('');
              logger.debug(`Restored ${logsData.logs.length} log chunks`);
            }
          }
        } catch (logErr) {
          logger.warn('Failed to fetch execution logs, using status output:', logErr);
        }
      }

      if (
        statusData.executionStatus === 'running' ||
        statusData.executionStatus === 'waiting_for_input'
      ) {
        setIsExecuting(true);
        setExecutionStatus('running');
        setExecutingTask({
          taskId,
          sessionId: statusData.sessionId,
          status:
            statusData.executionStatus === 'waiting_for_input' ? 'waiting_for_input' : 'running',
        });
      } else if (statusData.executionStatus === 'interrupted') {
        // Display interrupted state as idle (treat as non-running after server restart)
        setIsExecuting(false);
        setExecutionStatus('idle');
      } else if (statusData.executionStatus === 'completed') {
        setIsExecuting(false);
        setExecutionStatus('completed');
      } else if (statusData.executionStatus === 'failed') {
        setIsExecuting(false);
        setExecutionStatus('failed');
      }

      setExecutionResult({
        success: statusData.executionStatus !== 'failed',
        sessionId: statusData.sessionId,
        executionId: statusData.executionId,
        message: '実行状態を復元しました',
        output: fullOutput,
        waitingForInput: statusData.waitingForInput,
        question: statusData.question,
        error: statusData.errorMessage || undefined,
      });

      return {
        sessionId: statusData.sessionId,
        executionId: statusData.executionId,
        output: fullOutput,
        status: statusData.executionStatus,
        waitingForInput: statusData.waitingForInput,
        question: statusData.question,
        questionType: statusData.questionType,
        questionDetails: statusData.questionDetails,
      };
    } catch (err) {
      logger.error('Failed to restore execution state:', err);
      return null;
    }
  };

  return {
    config,
    isLoading,
    isAnalyzing,
    // NOTE: While restoring, suppress execution state to prevent "running" flash.
    // Downstream components see idle state and show skeleton instead of running panel.
    isExecuting: isRestoringState ? false : isExecuting,
    isRestoringState,
    executionStatus: isRestoringState ? ('idle' as ExecutionStatus) : executionStatus,
    executionResult: isRestoringState ? null : executionResult,
    analysisResult,
    analysisApprovalId,
    sessions,
    error,
    analysisError,
    agentConfigId,
    setAgentConfigId,
    agents,
    fetchAgents,
    fetchConfig,
    enableDeveloperMode,
    disableDeveloperMode,
    updateConfig,
    analyzeTask,
    fetchSessions,
    setAnalysisResult,
    executeAgent,
    resetExecutionState,
    restoreExecutionState,
    approveSubtaskCreation,
    stopExecution,
    setExecutionCancelled,
  };
}
