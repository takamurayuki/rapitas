'use client';
// useAgentExecutionActions

import { useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { createLogger } from '@/lib/logger';
import type { ExecutionStatus, ExecutionResult } from '@/types';
import { safeJsonParse } from './safe-json-parse';

const logger = createLogger('useAgentExecutionActions');

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
  const {
    setExecutingTask,
    removeExecutingTask,
    setTaskLoading,
    setTaskLoaded,
  } = useExecutionStateStore();
  const { setIsExecuting, setExecutionStatus, setExecutionResult, setError } =
    setters;

  // Ref-based mutex: prevents double execution immediately, bypassing async React state updates
  const isExecutingRef = useRef(false);

  /**
   * Parse a raw HTTP response, returning a structured data object.
   * Maps known error patterns to Japanese user-facing messages.
   *
   * @param res - Fetch Response object / <fetchのResponseオブジェクト>
   * @returns Parsed data record / <パースしたデータオブジェクト>
   */
  const parseResponse = async (
    res: Response,
  ): Promise<Record<string, unknown>> => {
    let responseText: string | null = null;
    try {
      responseText = await res.text();
      const parseResult = safeJsonParse(responseText);

      if (parseResult.success) {
        return parseResult.data as Record<string, unknown>;
      }

      logger.warn('JSON parse failed:', parseResult.error);

      if (!responseText || responseText.trim() === '') {
        throw new Error(
          'サーバーからの応答がありません。しばらくしてから再度お試しください。',
        );
      }

      if (parseResult.error?.includes('Database query error')) {
        return {
          error:
            'データベースクエリエラーが発生しました。しばらくしてから再度お試しください。',
        };
      }

      if (
        responseText.trim().startsWith('Error:') ||
        responseText.trim().startsWith('Invalid')
      ) {
        return { error: responseText.trim() };
      }

      return { error: 'サーバーの応答形式が正しくありません。' };
    } catch (textErr) {
      logger.warn('Failed to read response:', textErr);
      return {
        error: 'サーバーとの通信中にエラーが発生しました。再度お試しください。',
      };
    }
  };

  /**
   * Execute a new agent session or continue an existing one.
   * A ref-based mutex prevents duplicate concurrent calls.
   *
   * @param options - Execution parameters / <実行パラメータ>
   * @returns Server response data, null on error, or undefined if blocked
   */
  const executeAgent = useCallback(
    async (options?: {
      instruction?: string;
      branchName?: string;
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

      try {
        if (options?.sessionId && options?.instruction) {
          // Continuation execution path
          const res = await fetch(
            `${API_BASE_URL}/tasks/${taskId}/continue-execution`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instruction: options.instruction,
                sessionId: options.sessionId,
                agentConfigId:
                  options.agentConfigId ?? agentConfigId ?? undefined,
              }),
            },
          );

          if (res.status === 404) {
            logger.error('Endpoint not found:', res.url);
            throw new Error(
              '実行エンドポイントが見つかりません。サーバーの設定を確認してください。',
            );
          }

          const data = await parseResponse(res);

          if (res.ok) {
            setExecutionResult({
              success: true,
              sessionId: data.sessionId as number,
              message: (data.message as string) || '継続実行を開始しました',
            });
            setExecutionStatus('running');
            setExecutingTask({
              taskId,
              sessionId: data.sessionId as number,
              status: 'running',
            });
            return data;
          } else {
            throw new Error((data.error as string) || '継続実行に失敗しました');
          }
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

          if (res.status === 404) {
            logger.error('Endpoint not found:', res.url);
            throw new Error(
              '実行エンドポイントが見つかりません。サーバーの設定を確認してください。',
            );
          }

          // Prevent double execution (409 Conflict)
          if (res.status === 409) {
            const conflictData = (await res.json().catch(() => ({}))) as Record<
              string,
              unknown
            >;
            logger.warn('Duplicate execution rejected:', conflictData);
            throw new Error(
              (conflictData.error as string) || 'このタスクは既に実行中です。',
            );
          }

          const data = await parseResponse(res);

          if (res.ok) {
            setExecutionResult({
              success: true,
              sessionId: data.sessionId as number,
              message:
                (data.message as string) || 'エージェント実行を開始しました',
            });
            setExecutionStatus('running');
            setExecutingTask({
              taskId,
              sessionId: data.sessionId as number,
              status: 'running',
            });
            return data;
          } else {
            throw new Error(
              (data.error as string) || 'エージェントの実行に失敗しました',
            );
          }
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'エラーが発生しました';
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
      setExecutingTask,
      removeExecutingTask,
    ],
  );

  /**
   * Stop the running agent and update UI to idle state.
   *
   * @returns true if the stop request succeeded / <停止リクエスト成功時true>
   */
  const stopExecution = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        {
          method: 'POST',
        },
      );
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
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/reset-execution-state`,
        {
          method: 'POST',
        },
      );
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
