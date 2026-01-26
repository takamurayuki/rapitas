"use client";

import { useState, useCallback } from "react";
import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  AgentSession,
} from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export type ExecutionStatus = "idle" | "running" | "completed" | "failed";

export type ExecutionResult = {
  success: boolean;
  sessionId?: number;
  executionId?: number;
  approvalRequestId?: number;
  message?: string;
  error?: string;
};

export function useDeveloperMode(taskId: number) {
  const [config, setConfig] = useState<DeveloperModeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] =
    useState<ExecutionStatus>("idle");
  const [executionResult, setExecutionResult] =
    useState<ExecutionResult | null>(null);
  const [analysisResult, setAnalysisResult] =
    useState<TaskAnalysisResult | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

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
      setError("設定の取得に失敗しました");
    } finally {
      setIsLoading(false);
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
          },
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
    [taskId],
  );

  const disableDeveloperMode = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/disable/${taskId}`,
        {
          method: "DELETE",
        },
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
          },
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
    [taskId],
  );

  const analyzeTask = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/analyze/${taskId}`,
        {
          method: "POST",
        },
      );
      const data = await res.json();
      if (res.ok) {
        setAnalysisResult(data.analysis);
        return data;
      } else {
        throw new Error(data.error || "分析に失敗しました");
      }
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : "エラーが発生しました",
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
      console.error("Failed to fetch sessions:", err);
    }
  }, [taskId]);

  /**
   * AIエージェントを実行してタスクを実装
   */
  const executeAgent = useCallback(
    async (options?: {
      instruction?: string;
      branchName?: string;
      workingDirectory?: string;
    }) => {
      setIsExecuting(true);
      setExecutionStatus("running");
      setExecutionResult(null);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options || {}),
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
        const errorMessage =
          err instanceof Error ? err.message : "エラーが発生しました";
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
    [taskId],
  );

  /**
   * 実行状態をリセット
   */
  const resetExecutionState = useCallback(() => {
    setExecutionStatus("idle");
    setExecutionResult(null);
    setError(null);
  }, []);

  return {
    config,
    isLoading,
    isAnalyzing,
    isExecuting,
    executionStatus,
    executionResult,
    analysisResult,
    sessions,
    error,
    analysisError,
    fetchConfig,
    enableDeveloperMode,
    disableDeveloperMode,
    updateConfig,
    analyzeTask,
    fetchSessions,
    setAnalysisResult,
    executeAgent,
    resetExecutionState,
  };
}
