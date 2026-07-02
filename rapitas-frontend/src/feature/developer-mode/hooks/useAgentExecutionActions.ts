'use client';
// useAgentExecutionActions

import { useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { createLogger } from '@/lib/logger';
import type { ExecutionStatus, ExecutionResult } from '@/types';
import { safeJsonParse } from './safe-json-parse';

const logger = createLogger('useAgentExecutionActions');

// ────────────────────────────────────────────────────────────────────────────
// API Response Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Scoped translation function, injected by the calling hook. */
type T = (key: string) => string;

/**
 * Parse a raw HTTP response, returning a structured data object.
 * Maps known error patterns to user-facing messages.
 */
async function parseApiResponse(res: Response, t: T): Promise<Record<string, unknown>> {
  let responseText: string | null = null;
  try {
    responseText = await res.text();
    const parseResult = safeJsonParse(responseText);

    if (parseResult.success) {
      return parseResult.data as Record<string, unknown>;
    }

    logger.warn('JSON parse failed:', parseResult.error);

    if (!responseText || responseText.trim() === '') {
      throw new Error(t('noServerResponse'));
    }

    if (parseResult.error?.includes('Database query error')) {
      return {
        error: t('databaseQueryError'),
      };
    }

    if (responseText.trim().startsWith('Error:') || responseText.trim().startsWith('Invalid')) {
      return { error: responseText.trim() };
    }

    return { error: t('invalidResponseFormat') };
  } catch {
    logger.warn('Failed to read response');
    return { error: t('communicationError') };
  }
}

/**
 * Check for 404 error and throw appropriate message.
 */
function check404Error(res: Response, t: T): void {
  if (res.status === 404) {
    logger.error('Endpoint not found:', res.url);
    throw new Error(t('endpointNotFound'));
  }
}

/**
 * Check for 409 conflict error (duplicate execution).
 */
async function check409Conflict(res: Response, t: T): Promise<void> {
  if (res.status === 409) {
    const conflictData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    logger.warn('Duplicate execution rejected:', conflictData);
    throw new Error((conflictData.error as string) || t('alreadyRunning'));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface AgentExecutionSetters {
  setIsExecuting: (v: boolean) => void;
  setExecutionStatus: (s: ExecutionStatus) => void;
  setExecutionResult: (r: ExecutionResult | null) => void;
  setError: (e: string | null) => void;
}

interface UseAgentExecutionActionsReturn {
  executeAgent: (options?: {
    instruction?: string;
    branchName?: string;
    baseBranch?: string;
    workingDirectory?: string;
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
  }) => Promise<Record<string, unknown> | null | undefined>;
  stopExecution: () => Promise<boolean>;
  resetExecutionState: () => Promise<void>;
  setExecutionCancelled: () => void;
}

/**
 * Builds agent execution action callbacks for the given task.
 *
 * @param taskId - Task ID being executed / <実行対象タスクID>
 * @param agentConfigId - Optional agent configuration ID / <エージェント設定ID>
 * @param setters - State setter callbacks from the parent hook / <親フックのstate setter群>
 * @returns UseAgentExecutionActionsReturn
 */
export function useAgentExecutionActions(
  taskId: number,
  agentConfigId: number | null,
  setters: AgentExecutionSetters,
): UseAgentExecutionActionsReturn {
  const t = useTranslations('devMode.useAgentExecutionActions');
  const { setExecutingTask, removeExecutingTask, setTaskLoading, setTaskLoaded } =
    useExecutionStateStore();
  const { setIsExecuting, setExecutionStatus, setExecutionResult, setError } = setters;

  // Ref-based mutex: prevents double execution immediately, bypassing async React state updates
  const isExecutingRef = useRef(false);

  /** Handle successful execution response. */
  const handleExecutionSuccess = useCallback(
    (data: Record<string, unknown>, message: string): Record<string, unknown> => {
      setExecutionResult({
        success: true,
        sessionId: data.sessionId as number,
        message: (data.message as string) || message,
      });
      setExecutionStatus('running');
      setExecutingTask({
        taskId,
        sessionId: data.sessionId as number,
        status: 'running',
      });
      return data;
    },
    [taskId, setExecutionResult, setExecutionStatus, setExecutingTask],
  );

  /**
   * Execute a new agent session or continue an existing one.
   * A ref-based mutex prevents duplicate concurrent calls.
   */
  const executeAgent = useCallback(
    async (options?: {
      instruction?: string;
      branchName?: string;
      baseBranch?: string;
      workingDirectory?: string;
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
    }): Promise<Record<string, unknown> | null | undefined> => {
      if (isExecutingRef.current) {
        logger.warn('Duplicate execution blocked: already executing');
        return undefined;
      }
      isExecutingRef.current = true;

      setIsExecuting(true);
      setExecutionStatus('running');
      setExecutionResult(null);
      setError(null);
      // Optimistically flip the task to in-progress in the SHARED list cache so
      // the task list reflects the run immediately — the detail already does this
      // locally, but the list otherwise waited for the executing-tasks poll.
      useTaskCacheStore.getState().updateTaskLocally(taskId, { status: 'in-progress' });

      try {
        if (options?.sessionId && options?.instruction) {
          // Continuation execution path
          const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/continue-execution`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instruction: options.instruction,
              sessionId: options.sessionId,
              agentConfigId: options.agentConfigId ?? agentConfigId ?? undefined,
            }),
          });

          check404Error(res, t);
          const data = await parseApiResponse(res, t);

          if (res.ok) {
            return handleExecutionSuccess(data, t('continuationStarted'));
          }
          throw new Error((data.error as string) || t('continuationFailed'));
        } else {
          // New execution path
          const requestBody = {
            ...options,
            agentConfigId: options?.agentConfigId ?? agentConfigId ?? undefined,
          };
          const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          check404Error(res, t);
          await check409Conflict(res, t);
          const data = await parseApiResponse(res, t);

          if (res.ok) {
            return handleExecutionSuccess(data, t('executionStarted'));
          }
          throw new Error((data.error as string) || t('executeFailed'));
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : t('genericError');
        setError(errorMessage);
        setExecutionStatus('failed');
        setExecutionResult({ success: false, error: errorMessage });
        removeExecutingTask(taskId);
        return null;
      } finally {
        isExecutingRef.current = false;
        setIsExecuting(false);
      }
    },
    [
      taskId,
      agentConfigId,
      setIsExecuting,
      setExecutionStatus,
      setExecutionResult,
      setError,
      removeExecutingTask,
      handleExecutionSuccess,
      t,
    ],
  );

  /**
   * Stop the running agent and update UI to idle state.
   *
   * @returns true if the stop request succeeded / <停止リクエスト成功時true>
   */
  const stopExecution = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/stop-execution`, {
        method: 'POST',
      });
      if (res.ok) {
        setIsExecuting(false);
        setExecutionStatus('idle');
        removeExecutingTask(taskId);
        return true;
      }
      return false;
    } catch (err) {
      logger.error('Failed to stop execution:', err);
      return false;
    }
  }, [taskId, setIsExecuting, setExecutionStatus, removeExecutingTask]);

  /**
   * Reset execution state both locally and in the database.
   */
  const resetExecutionState = useCallback(async (): Promise<void> => {
    isExecutingRef.current = false;
    setIsExecuting(false);
    setExecutionStatus('idle');
    setExecutionResult(null);
    setError(null);
    removeExecutingTask(taskId);

    // NOTE: Briefly set loading flag to force TaskAISection unmount→remount.
    // This resets all internal hook state (hasExecutedRef, isRestoring, etc.)
    setTaskLoading(taskId);

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/reset-execution-state`, {
        method: 'POST',
      });
      if (res.ok) {
        logger.debug('Execution state reset successfully');
      } else {
        logger.error('Failed to reset execution state in DB');
      }
    } catch (err) {
      logger.error('Error resetting execution state:', err);
    }

    // NOTE: Clear loading flag after a brief delay so the component remounts fresh
    setTimeout(() => {
      isExecutingRef.current = false;
      setIsExecuting(false);
      setExecutionStatus('idle');
      setExecutionResult(null);
      setTaskLoaded(taskId);
    }, 300);
  }, [
    taskId,
    setIsExecuting,
    setExecutionStatus,
    setExecutionResult,
    setError,
    removeExecutingTask,
    setTaskLoading,
    setTaskLoaded,
  ]);

  /** Cancel execution immediately without waiting for the server. */
  const setExecutionCancelled = useCallback((): void => {
    setIsExecuting(false);
    setExecutionStatus('idle');
    removeExecutingTask(taskId);
  }, [taskId, setIsExecuting, setExecutionStatus, removeExecutingTask]);

  return {
    executeAgent,
    stopExecution,
    resetExecutionState,
    setExecutionCancelled,
  };
}
