'use client';

import { useState, useCallback, useRef } from 'react';
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

export type { ExecutionStatus, ExecutionResult };

/**
 * Safe JSON parsing with improved validation
 */
function safeJsonParse(text: string): { success: boolean; data?: unknown; error?: string } {
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
        error: `JSON parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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

  // Ref-based排他制御: React状態の非同期更新を回避して即座に二重実行を防止
  const isExecutingRef = useRef(false);

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
   * 進行中の実行状態を復元する
   * コンポーネントのマウント時に呼び出して、実行中のエージェントがあれば状態を復元する
   * アプリ再起動後もログを復元できるようにDBからログ履歴を取得する
   */
  const restoreExecutionState = useCallback(async () => {
    try {
      // まず実行ステータスを確認
      const statusRes = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/execution-status`,
      );
      if (!statusRes.ok) return null;

      const statusData = await statusRes.json();

      // 実行データがない場合はスキップ
      if (!statusData.executionStatus || statusData.status === 'none') {
        return null;
      }

      // 実行中、入力待ち、中断、または完了した実行がある場合はログ履歴を取得
      if (
        statusData.executionStatus === 'running' ||
        statusData.executionStatus === 'waiting_for_input' ||
        statusData.executionStatus === 'interrupted' ||
        statusData.executionStatus === 'completed' ||
        statusData.executionStatus === 'failed'
      ) {
        // ログ履歴を取得
        let fullOutput = statusData.output || '';
        try {
          const logsRes = await fetch(
            `${API_BASE_URL}/tasks/${taskId}/execution-logs`,
          );
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            if (logsData.logs && logsData.logs.length > 0) {
              // ログチャンクを結合して完全な出力を復元
              fullOutput = logsData.logs
                .map((log: { chunk: string }) => log.chunk)
                .join('');
              console.log(
                `[restoreExecutionState] Restored ${logsData.logs.length} log chunks`,
              );
            }
          }
        } catch (logErr) {
          console.warn(
            'Failed to fetch execution logs, using status output:',
            logErr,
          );
        }

        // 実行中、入力待ちの場合はUI状態を「実行中」に更新
        if (
          statusData.executionStatus === 'running' ||
          statusData.executionStatus === 'waiting_for_input'
        ) {
          setIsExecuting(true);
          setExecutionStatus('running');
          // グローバルストアに実行中タスクを記録
          setExecutingTask({
            taskId,
            sessionId: statusData.sessionId,
            status:
              statusData.executionStatus === 'waiting_for_input'
                ? 'waiting_for_input'
                : 'running',
          });
        } else if (statusData.executionStatus === 'interrupted') {
          // 中断された実行がある場合（サーバー再起動後など）
          // 中断状態を適切に表示（failedではなくinterruptedとして扱う）
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
      console.error('Failed to restore execution state:', err);
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
        // 承認リクエストIDを保存（自動承認でない場合）
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
      console.error('Failed to fetch sessions:', err);
    }
  }, [taskId]);

  /**
   * 分析結果のサブタスク提案を承認してサブタスクを作成
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
          // 承認成功後、状態をクリア
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
   * AIエージェントを実行してタスクを実装
   */
  const executeAgent = useCallback(
    async (options?: {
      instruction?: string;
      branchName?: string;
      workingDirectory?: string;
      useTaskAnalysis?: boolean; // AIタスク分析を使用するか
      optimizedPrompt?: string; // 最適化されたプロンプト
      agentConfigId?: number; // 使用するエージェント設定ID
      sessionId?: number; // 既存のセッションID（継続実行時）
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
      // Ref-based排他制御: 二重実行防止
      if (isExecutingRef.current) {
        console.warn('[useDeveloperMode] Duplicate execution blocked: already executing');
        return undefined;
      }
      isExecutingRef.current = true;

      setIsExecuting(true);
      setExecutionStatus('running');
      setExecutionResult(null);
      setError(null);
      try {
        // 既存のセッションIDがある場合は継続実行エンドポイントを使用
        if (options?.sessionId && options?.instruction) {
          // 継続実行用のエンドポイント
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

          // レスポンスがJSONかどうかを確認
          // Check if endpoint exists (404 error)
          if (res.status === 404) {
            console.error('[useDeveloperMode] Endpoint not found:', res.url);
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
              console.warn('[useDeveloperMode] JSON parse failed:', parseResult.error);

              // If response is empty, it might be still processing
              if (!responseText || responseText.trim() === '') {
                throw new Error(
                  'サーバーからの応答がありません。しばらくしてから再度お試しください。',
                );
              }

              // Map known error patterns to user-friendly messages
              if (parseResult.error?.includes('Database query error')) {
                data = { error: 'データベースクエリエラーが発生しました。しばらくしてから再度お試しください。' };
              } else if (responseText.trim().startsWith('Error:') || responseText.trim().startsWith('Invalid')) {
                data = { error: responseText.trim() };
              } else {
                data = { error: 'サーバーの応答形式が正しくありません。' };
              }
            }
          } catch (textErr) {
            console.warn(
              '[useDeveloperMode] Failed to read response:',
              textErr,
            );
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
            // グローバルストアに実行中タスクを記録
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
          // 新規実行の場合は通常のエンドポイントを使用
          // agentConfigIdはoptions内の値を優先し、なければhookの状態値を使用
          const requestBody = {
            ...options,
            agentConfigId: options?.agentConfigId ?? agentConfigId ?? undefined,
          };
          const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          // レスポンスがJSONかどうかを確認
          // Check if endpoint exists (404 error)
          if (res.status === 404) {
            console.error('[useDeveloperMode] Endpoint not found:', res.url);
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
              console.warn('[useDeveloperMode] JSON parse failed:', parseResult.error);

              // If response is empty, it might be still processing
              if (!responseText || responseText.trim() === '') {
                throw new Error(
                  'サーバーからの応答がありません。しばらくしてから再度お試しください。',
                );
              }

              // Map known error patterns to user-friendly messages
              if (parseResult.error?.includes('Database query error')) {
                data = { error: 'データベースクエリエラーが発生しました。しばらくしてから再度お試しください。' };
              } else if (responseText.trim().startsWith('Error:') || responseText.trim().startsWith('Invalid')) {
                data = { error: responseText.trim() };
              } else {
                data = { error: 'サーバーの応答形式が正しくありません。' };
              }
            }
          } catch (textErr) {
            console.warn(
              '[useDeveloperMode] Failed to read response:',
              textErr,
            );
            data = {
              error:
                'サーバーとの通信中にエラーが発生しました。再度お試しください。',
            };
          }

          if (res.ok) {
            setExecutionResult({
              success: true,
              sessionId: data.sessionId as number,
              message: (data.message as string) || 'エージェント実行を開始しました',
            });
            setExecutionStatus('running');
            // グローバルストアに実行中タスクを記録
            setExecutingTask({
              taskId,
              sessionId: data.sessionId as number,
              status: 'running',
            });
            return data;
          } else {
            throw new Error((data.error as string) || 'エージェントの実行に失敗しました');
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
        // 失敗時はストアから除去
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
   * 実行状態をリセット（DBとローカル状態の両方をリセット）
   */
  const resetExecutionState = useCallback(async () => {
    // ローカル状態をリセット
    isExecutingRef.current = false;
    setIsExecuting(false);
    setExecutionStatus('idle');
    setExecutionResult(null);
    setError(null);

    // DBの実行状態もリセット
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/reset-execution-state`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        const data = await res.json();
        console.log('[useDeveloperMode] Execution state reset:', data);
      } else {
        console.error(
          '[useDeveloperMode] Failed to reset execution state in DB',
        );
      }
    } catch (err) {
      console.error('[useDeveloperMode] Error resetting execution state:', err);
    }
  }, [taskId]);

  /**
   * 実行を停止してUIを復元
   */
  const stopExecution = useCallback(async () => {
    try {
      // タスクレベルの停止エンドポイントを呼び出し
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        {
          method: 'POST',
        },
      );

      if (res.ok) {
        // UIを即座に停止状態に更新
        setIsExecuting(false);
        setExecutionStatus('idle');
        // グローバルストアから除去
        removeExecutingTask(taskId);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to stop execution:', err);
      return false;
    }
  }, [taskId, removeExecutingTask]);

  /**
   * 実行をキャンセル状態に設定（UIの即時更新用）
   */
  const setExecutionCancelled = useCallback(() => {
    setIsExecuting(false);
    setExecutionStatus('idle');
    // グローバルストアから除去
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
      console.error('Failed to fetch agents:', err);
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
