"use client";

import { useState, useCallback } from "react";
import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  AgentSession,
  ExecutionStatus,
  ExecutionResult,
  AIAgentConfig,
} from "@/types";
import { API_BASE_URL } from "@/utils/api";

export type { ExecutionStatus, ExecutionResult };

export function useDeveloperMode(taskId: number) {
  const [config, setConfig] = useState<DeveloperModeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>("idle");
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [analysisResult, setAnalysisResult] =
    useState<TaskAnalysisResult | null>(null);
  const [analysisApprovalId, setAnalysisApprovalId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [agentConfigId, setAgentConfigId] = useState<number | null>(null);
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/config/${taskId}`
      );
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      } else {
        setConfig(null);
      }
    } catch (err) {
      setError("設定の取得に失敗しました");
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
      const statusRes = await fetch(`${API_BASE_URL}/tasks/${taskId}/execution-status`);
      if (!statusRes.ok) return null;

      const statusData = await statusRes.json();

      // 実行データがない場合はスキップ
      if (!statusData.executionStatus || statusData.status === "none") {
        return null;
      }

      // 実行中、入力待ち、または完了した実行がある場合はログ履歴を取得
      if (statusData.executionStatus === "running" ||
          statusData.executionStatus === "waiting_for_input" ||
          statusData.executionStatus === "completed" ||
          statusData.executionStatus === "failed") {

        // ログ履歴を取得
        let fullOutput = statusData.output || "";
        try {
          const logsRes = await fetch(`${API_BASE_URL}/tasks/${taskId}/execution-logs`);
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            if (logsData.logs && logsData.logs.length > 0) {
              // ログチャンクを結合して完全な出力を復元
              fullOutput = logsData.logs.map((log: { chunk: string }) => log.chunk).join("");
              console.log(`[restoreExecutionState] Restored ${logsData.logs.length} log chunks`);
            }
          }
        } catch (logErr) {
          console.warn("Failed to fetch execution logs, using status output:", logErr);
        }

        // 実行中または入力待ちの場合のみUI状態を更新
        if (statusData.executionStatus === "running" || statusData.executionStatus === "waiting_for_input") {
          setIsExecuting(true);
          setExecutionStatus("running");
        }

        setExecutionResult({
          success: true,
          sessionId: statusData.sessionId,
          executionId: statusData.executionId,
          message: "実行状態を復元しました",
          output: fullOutput,
          waitingForInput: statusData.waitingForInput,
          question: statusData.question,
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
      console.error("Failed to restore execution state:", err);
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
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options || {}),
          }
        );
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          return data;
        } else {
          throw new Error("有効化に失敗しました");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId]
  );

  const disableDeveloperMode = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/disable/${taskId}`,
        {
          method: "DELETE",
        }
      );
      if (res.ok) {
        setConfig(null);
        setAnalysisResult(null);
        return true;
      } else {
        throw new Error("無効化に失敗しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
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
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          }
        );
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          return data;
        } else {
          throw new Error("更新に失敗しました");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId]
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
          method: "POST",
        }
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
        throw new Error(data.error || "分析に失敗しました");
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "エラーが発生しました");
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [taskId]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/sessions/${taskId}`
      );
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  }, [taskId]);

  /**
   * 分析結果のサブタスク提案を承認してサブタスクを作成
   */
  const approveSubtaskCreation = useCallback(
    async (selectedSubtaskIndices?: number[]) => {
      if (!analysisApprovalId) {
        setError("承認リクエストがありません");
        return null;
      }

      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/approvals/${analysisApprovalId}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selectedSubtasks: selectedSubtaskIndices,
            }),
          }
        );
        const data = await res.json();
        if (res.ok) {
          // 承認成功後、状態をクリア
          setAnalysisApprovalId(null);
          return data;
        } else {
          throw new Error(data.error || "承認に失敗しました");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [analysisApprovalId]
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
      setIsExecuting(true);
      setExecutionStatus("running");
      setExecutionResult(null);
      setError(null);
      try {
        // agentConfigIdはoptions内の値を優先し、なければhookの状態値を使用
        const requestBody = {
          ...options,
          agentConfigId: options?.agentConfigId ?? agentConfigId ?? undefined,
        };
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const data = await res.json();
        if (res.ok) {
          setExecutionResult({
            success: true,
            sessionId: data.sessionId,
            message: data.message || "エージェント実行を開始しました",
          });
          setExecutionStatus("completed");
          return data;
        } else {
          throw new Error(data.error || "エージェントの実行に失敗しました");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "エラーが発生しました";
        setError(errorMessage);
        setExecutionStatus("failed");
        setExecutionResult({
          success: false,
          error: errorMessage,
        });
        return null;
      } finally {
        setIsExecuting(false);
      }
    },
    [taskId, agentConfigId]
  );

  /**
   * 実行状態をリセット（DBとローカル状態の両方をリセット）
   */
  const resetExecutionState = useCallback(async () => {
    // ローカル状態をリセット
    setIsExecuting(false);
    setExecutionStatus("idle");
    setExecutionResult(null);
    setError(null);

    // DBの実行状態もリセット
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/reset-execution-state`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        console.log("[useDeveloperMode] Execution state reset:", data);
      } else {
        console.error("[useDeveloperMode] Failed to reset execution state in DB");
      }
    } catch (err) {
      console.error("[useDeveloperMode] Error resetting execution state:", err);
    }
  }, [taskId]);

  /**
   * 実行を停止してUIを復元
   */
  const stopExecution = useCallback(async () => {
    try {
      // タスクレベルの停止エンドポイントを呼び出し
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/stop-execution`, {
        method: "POST",
      });

      if (res.ok) {
        // UIを即座に停止状態に更新
        setIsExecuting(false);
        setExecutionStatus("idle");
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to stop execution:", err);
      return false;
    }
  }, [taskId]);

  /**
   * 実行をキャンセル状態に設定（UIの即時更新用）
   */
  const setExecutionCancelled = useCallback(() => {
    setIsExecuting(false);
    setExecutionStatus("idle");
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents`);
      if (res.ok) {
        const data = await res.json();
        const activeAgents = (data as AIAgentConfig[]).filter((a) => a.isActive);
        setAgents(activeAgents);
        if (!agentConfigId && activeAgents.length > 0) {
          const defaultAgent = activeAgents.find((a) => a.isDefault);
          if (defaultAgent) {
            setAgentConfigId(defaultAgent.id);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch agents:", err);
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
