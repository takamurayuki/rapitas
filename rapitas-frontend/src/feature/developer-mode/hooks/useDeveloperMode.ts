'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  AgentSession,
  ExecutionStatus,
  ExecutionResult,
  AIAgentConfig,
} from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDeveloperMode');

export type { ExecutionStatus, ExecutionResult };

/**
 * Safe JSON parsing with improved validation
 */
function safeJsonParse(text: string): {
  success: boolean;
  data?: unknown;
  error?: string;
} {
  // Basic validation
  if (!text || typeof text !== 'string') {
    return { success: false, error: 'Empty or invalid response text' };
  }

  const trimmed = text.trim();

  // Check if it looks like JSON first (most common case)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // Check if JSON appears complete (basic bracket matching)
    if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
      return { success: false, error: 'Incomplete JSON object detected' };
    }
    if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
      return { success: false, error: 'Incomplete JSON array detected' };
    }

    try {
      const data = JSON.parse(trimmed);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: `JSON parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Non-JSON response - detect specific error patterns
  if (
    trimmed.startsWith('Invalid `prisma') ||
    trimmed.startsWith('Invalid `p') ||
    trimmed.includes('PrismaClient') ||
    trimmed.includes('@prisma/client')
  ) {
    return { success: false, error: 'Database query error detected' };
  }

  if (trimmed.startsWith('Error:') || trimmed.startsWith('ERROR:')) {
    return { success: false, error: trimmed };
  }

  return { success: false, error: 'Response is not JSON format' };
}

export function useDeveloperMode(taskId: number) {
  const [config, setConfig] = useState<DeveloperModeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] =
    useState<ExecutionStatus>('idle');
  const [executionResult, setExecutionResult] =
    useState<ExecutionResult | null>(null);
  const [analysisResult, setAnalysisResult] =
    useState<TaskAnalysisResult | null>(null);
  const [analysisApprovalId, setAnalysisApprovalId] = useState<number | null>(
    null,
  );
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [agentConfigId, setAgentConfigId] = useState<number | null>(null);
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);
  const { setExecutingTask, removeExecutingTask } = useExecutionStateStore();

  // Ref-based mutex: prevents double execution immediately, bypassing async React state updates
  const isExecutingRef = useRef(false);

  // Reset state when taskId changes (navigating to a different task detail)
  const prevTaskIdRef = useRef(taskId);
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      // Reset previous task's execution state when switching to new taskId
      isExecutingRef.current = false;
      setIsExecuting(false);
      setExecutionStatus('idle');
      setExecutionResult(null);
      setAnalysisResult(null);
      setAnalysisApprovalId(null);
      setError(null);
    }
  }, [taskId]);

  // Reset ref on component unmount
  useEffect(() => {
    return () => {
      isExecutingRef.current = false;
    };
  }, []);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/config/${taskId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      } else {
        setConfig(null);
      }
    } catch (err) {
      setError('設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  /**
   * Restore in-progress execution state.
   * Called on component mount to recover running agent state and fetch log history from DB
   * so logs can be restored even after app restart.
   */
  const restoreExecutionState = useCallback(async () => {
    // Skip if execution already started (prevent conflict with autoExecute)
    if (isExecutingRef.current) {
      return null;
    }
    try {
      // First check execution status
      const statusRes = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/execution-status`,
      );
      if (!statusRes.ok) return null;

      const statusData = await statusRes.json();

      // Skip if no execution data
      if (!statusData.executionStatus || statusData.status === 'none') {
        return null;
      }

      // Fetch log history if there's running, input-waiting, interrupted, or completed execution
      if (
        statusData.executionStatus === 'running' ||
        statusData.executionStatus === 'waiting_for_input' ||
        statusData.executionStatus === 'interrupted' ||
        statusData.executionStatus === 'completed' ||
        statusData.executionStatus === 'failed'
      ) {
        // NOTE: statusData.output contains the full output including the initial
        // "[実行開始]" message, while AgentExecutionLog chunks only contain streaming
        // output. Use statusData.output as primary source to preserve the initial message.
        let fullOutput = statusData.output || '';
        if (!fullOutput) {
          try {
            const logsRes = await fetch(
              `${API_BASE_URL}/tasks/${taskId}/execution-logs`,
            );
            if (logsRes.ok) {
              const logsData = await logsRes.json();
              if (logsData.logs && logsData.logs.length > 0) {
                fullOutput = logsData.logs
                  .map((log: { chunk: string }) => log.chunk)
                  .join('');
                logger.debug(`Restored ${logsData.logs.length} log chunks`);
              }
            }
          } catch (logErr) {
            logger.warn(
              'Failed to fetch execution logs, using status output:',
              logErr,
            );
          }
        }

        // Update UI state to "running" for running or input-waiting cases
        if (
          statusData.executionStatus === 'running' ||
          statusData.executionStatus === 'waiting_for_input'
        ) {
          setIsExecuting(true);
          setExecutionStatus('running');
          // Record executing task in global store
          setExecutingTask({
            taskId,
            sessionId: statusData.sessionId,
            status:
              statusData.executionStatus === 'waiting_for_input'
                ? 'waiting_for_input'
                : 'running',
          });
        } else if (statusData.executionStatus === 'interrupted') {
          // Handle interrupted execution (e.g., after server restart)
          // Display interrupted state properly (treat as interrupted, not failed)
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
      }

      return null;
    } catch (err) {
      logger.error('Failed to restore execution state:', err);
      return null;
    }
  }, [taskId]);

  const enableDeveloperMode = useCallback(
    async (options?: {
      autoApprove?: boolean;
      maxSubtasks?: number;
      priority?: string;
    }) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/developer-mode/enable/${taskId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options || {}),
          },
        );
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          return data;
        } else {
          throw new Error('有効化に失敗しました');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId],
  );

  const disableDeveloperMode = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/disable/${taskId}`,
        {
          method: 'DELETE',
        },
      );
      if (res.ok) {
        setConfig(null);
        setAnalysisResult(null);
        return true;
      } else {
        throw new Error('無効化に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  const updateConfig = useCallback(
    async (updates: Partial<DeveloperModeConfig>) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/developer-mode/config/${taskId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          },
        );
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          return data;
        } else {
          throw new Error('更新に失敗しました');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId],
  );

  const analyzeTask = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setAnalysisApprovalId(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/analyze/${taskId}`,
        {
          method: 'POST',
        },
      );
      const data = await res.json();
      if (res.ok) {
        setAnalysisResult(data.analysis);
        // Save approval request ID (when not auto-approved)
        if (data.approvalRequestId && !data.autoApproved) {
          setAnalysisApprovalId(data.approvalRequestId);
        }
        return data;
      } else {
        throw new Error(data.error || '分析に失敗しました');
      }
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : 'エラーが発生しました',
      );
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [taskId]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/sessions/${taskId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      logger.error('Failed to fetch sessions:', err);
    }
  }, [taskId]);

  /**
   * Approve subtask proposals from analysis results and create subtasks.
   */
  const approveSubtaskCreation = useCallback(
    async (selectedSubtaskIndices?: number[]) => {
      if (!analysisApprovalId) {
        setError('承認リクエストがありません');
        return null;
      }

      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/approvals/${analysisApprovalId}/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedSubtasks: selectedSubtaskIndices,
            }),
          },
        );
        const data = await res.json();
        if (res.ok) {
          // Clear state after successful approval
          setAnalysisApprovalId(null);
          return data;
        } else {
          throw new Error(data.error || '承認に失敗しました');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [analysisApprovalId],
  );

  /**
   * Execute an AI agent to implement the task.
   */
  const executeAgent = useCallback(
    async (options?: {
      instruction?: string;
      branchName?: string;
      workingDirectory?: string;
      useTaskAnalysis?: boolean; // Whether to use AI task analysis
      optimizedPrompt?: string; // Optimized prompt
      agentConfigId?: number; // Agent configuration ID to use
      sessionId?: number; // Existing session ID (for continuation)
      attachments?: Array<{
        id: number;
        title: string;
        type: string;
        fileName?: string;
        filePath?: string;
        mimeType?: string;
        description?: string;
      }>;
    }) => {
      // Ref-based mutex: prevent double execution
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
        // Use continuation endpoint if existing session ID is provided
        if (options?.sessionId && options?.instruction) {
          // Endpoint for continuation execution
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

          // Verify response is JSON
          // Check if endpoint exists (404 error)
          if (res.status === 404) {
            logger.error('Endpoint not found:', res.url);
            throw new Error(
              '実行エンドポイントが見つかりません。サーバーの設定を確認してください。',
            );
          }

          const contentType = res.headers.get('content-type');
          let data: Record<string, unknown>;
          let responseText: string | null = null;

          try {
            // Try to get response text first
            responseText = await res.text();

            // Use safe JSON parsing
            const parseResult = safeJsonParse(responseText);

            if (parseResult.success) {
              data = parseResult.data as Record<string, unknown>;
            } else {
              logger.warn('JSON parse failed:', parseResult.error);

              // If response is empty, it might be still processing
              if (!responseText || responseText.trim() === '') {
                throw new Error(
                  'サーバーからの応答がありません。しばらくしてから再度お試しください。',
                );
              }

              // Map known error patterns to user-friendly messages
              if (parseResult.error?.includes('Database query error')) {
                data = {
                  error:
                    'データベースクエリエラーが発生しました。しばらくしてから再度お試しください。',
                };
              } else if (
                responseText.trim().startsWith('Error:') ||
                responseText.trim().startsWith('Invalid')
              ) {
                data = { error: responseText.trim() };
              } else {
                data = { error: 'サーバーの応答形式が正しくありません。' };
              }
            }
          } catch (textErr) {
            logger.warn('Failed to read response:', textErr);
            data = {
              error:
                'サーバーとの通信中にエラーが発生しました。再度お試しください。',
            };
          }

          if (res.ok) {
            setExecutionResult({
              success: true,
              sessionId: data.sessionId as number,
              message: (data.message as string) || '継続実行を開始しました',
            });
            setExecutionStatus('running');
            // Record executing task in global store
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
          // Use normal endpoint for new execution
          // Prefer agentConfigId from options, fall back to hook state value
          const requestBody = {
            ...options,
            agentConfigId: options?.agentConfigId ?? agentConfigId ?? undefined,
          };
          const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          // Check if endpoint exists (404 error)
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

          const contentType = res.headers.get('content-type');
          let data: Record<string, unknown>;
          let responseText: string | null = null;

          try {
            // Try to get response text first
            responseText = await res.text();

            // Use safe JSON parsing
            const parseResult = safeJsonParse(responseText);

            if (parseResult.success) {
              data = parseResult.data as Record<string, unknown>;
            } else {
              logger.warn('JSON parse failed:', parseResult.error);

              // If response is empty, it might be still processing
              if (!responseText || responseText.trim() === '') {
                throw new Error(
                  'サーバーからの応答がありません。しばらくしてから再度お試しください。',
                );
              }

              // Map known error patterns to user-friendly messages
              if (parseResult.error?.includes('Database query error')) {
                data = {
                  error:
                    'データベースクエリエラーが発生しました。しばらくしてから再度お試しください。',
                };
              } else if (
                responseText.trim().startsWith('Error:') ||
                responseText.trim().startsWith('Invalid')
              ) {
                data = { error: responseText.trim() };
              } else {
                data = { error: 'サーバーの応答形式が正しくありません。' };
              }
            }
          } catch (textErr) {
            logger.warn('Failed to read response:', textErr);
            data = {
              error:
                'サーバーとの通信中にエラーが発生しました。再度お試しください。',
            };
          }

          if (res.ok) {
            setExecutionResult({
              success: true,
              sessionId: data.sessionId as number,
              message:
                (data.message as string) || 'エージェント実行を開始しました',
            });
            setExecutionStatus('running');
            // Record executing task in global store
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
        setExecutionResult({
          success: false,
          error: errorMessage,
        });
        // Remove from store on failure
        removeExecutingTask(taskId);
        return null;
      } finally {
        isExecutingRef.current = false;
        setIsExecuting(false);
      }
    },
    [taskId, agentConfigId, setExecutingTask, removeExecutingTask],
  );

  /**
   * Reset execution state (both DB and local state).
   */
  const resetExecutionState = useCallback(async () => {
    // Reset local state
    isExecutingRef.current = false;
    setIsExecuting(false);
    setExecutionStatus('idle');
    setExecutionResult(null);
    setError(null);

    // Reset execution state in DB as well
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/reset-execution-state`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        const data = await res.json();
        logger.debug('Execution state reset:', data);
      } else {
        logger.error('Failed to reset execution state in DB');
      }
    } catch (err) {
      logger.error('Error resetting execution state:', err);
    }
  }, [taskId]);

  /**
   * Stop execution and restore UI state.
   */
  const stopExecution = useCallback(async () => {
    try {
      // Call task-level stop endpoint
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        {
          method: 'POST',
        },
      );

      if (res.ok) {
        // Immediately update UI to stopped state
        setIsExecuting(false);
        setExecutionStatus('idle');
        // Remove from global store
        removeExecutingTask(taskId);
        return true;
      }
      return false;
    } catch (err) {
      logger.error('Failed to stop execution:', err);
      return false;
    }
  }, [taskId, removeExecutingTask]);

  /**
   * Set execution to cancelled state (for immediate UI updates).
   */
  const setExecutionCancelled = useCallback(() => {
    setIsExecuting(false);
    setExecutionStatus('idle');
    // Remove from global store
    removeExecutingTask(taskId);
  }, [taskId, removeExecutingTask]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents`);
      if (res.ok) {
        const data = await res.json();
        const activeAgents = (data as AIAgentConfig[]).filter(
          (a) => a.isActive,
        );
        setAgents(activeAgents);
        if (!agentConfigId && activeAgents.length > 0) {
          const defaultAgent = activeAgents.find((a) => a.isDefault);
          if (defaultAgent) {
            setAgentConfigId(defaultAgent.id);
          }
        }
      }
    } catch (err) {
      logger.error('Failed to fetch agents:', err);
    }
  }, [agentConfigId]);

  return {
    config,
    isLoading,
    isAnalyzing,
    isExecuting,
    executionStatus,
    executionResult,
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
