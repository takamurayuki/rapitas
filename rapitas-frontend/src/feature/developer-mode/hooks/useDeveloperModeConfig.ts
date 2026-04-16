'use client';
// useDeveloperModeConfig

import { useState, useCallback } from 'react';
import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  AgentSession,
  AIAgentConfig,
} from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDeveloperModeConfig');

export interface UseDeveloperModeConfigReturn {
  config: DeveloperModeConfig | null;
  isLoading: boolean;
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  analysisApprovalId: number | null;
  sessions: AgentSession[];
  error: string | null;
  analysisError: string | null;
  agentConfigId: number | null;
  agents: AIAgentConfig[];
  setConfig: (c: DeveloperModeConfig | null) => void;
  setError: (e: string | null) => void;
  setAnalysisResult: (r: TaskAnalysisResult | null) => void;
  setAgentConfigId: (id: number | null) => void;
  fetchConfig: () => Promise<void>;
  enableDeveloperMode: (options?: {
    autoApprove?: boolean;
    maxSubtasks?: number;
    priority?: string;
  }) => Promise<DeveloperModeConfig | null>;
  disableDeveloperMode: () => Promise<boolean>;
  updateConfig: (
    updates: Partial<DeveloperModeConfig>,
  ) => Promise<DeveloperModeConfig | null>;
  analyzeTask: () => Promise<unknown>;
  fetchSessions: () => Promise<void>;
  approveSubtaskCreation: (
    selectedSubtaskIndices?: number[],
  ) => Promise<unknown>;
  fetchAgents: () => Promise<void>;
}

/**
 * Manages developer-mode configuration and analysis state for a task.
 *
 * @param taskId - Task ID to manage / <管理対象タスクID>
 * @returns UseDeveloperModeConfigReturn
 */
export function useDeveloperModeConfig(
  taskId: number,
): UseDeveloperModeConfigReturn {
  const [config, setConfig] = useState<DeveloperModeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/config/${taskId}`,
      );
      if (res.ok) {
        setConfig(await res.json());
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
   * Enable developer mode for the task with optional configuration overrides.
   *
   * @param options - Configuration overrides / <設定の上書きオプション>
   * @returns Updated config or null on error / <更新設定またはエラー時null>
   */
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
        }
        throw new Error('有効化に失敗しました');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId],
  );

  /**
   * Disable developer mode for the task.
   *
   * @returns true on success / <成功時true>
   */
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
      }
      throw new Error('無効化に失敗しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  /**
   * Partially update developer-mode configuration fields.
   *
   * @param updates - Fields to patch / <更新するフィールド>
   * @returns Updated config or null on error / <更新設定またはエラー時null>
   */
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
        }
        throw new Error('更新に失敗しました');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId],
  );

  /**
   * Run AI task analysis, creating an approval request when auto-approve is off.
   *
   * @returns Analysis response data or null on error
   */
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
        if (data.approvalRequestId && !data.autoApproved) {
          setAnalysisApprovalId(data.approvalRequestId);
        }
        return data;
      }
      throw new Error(data.error || '分析に失敗しました');
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
        setSessions(await res.json());
      }
    } catch (err) {
      logger.error('Failed to fetch sessions:', err);
    }
  }, [taskId]);

  /**
   * Approve subtask proposals and create the selected subtasks.
   *
   * @param selectedSubtaskIndices - Optional subset of subtask indices / <承認するサブタスクのインデックス>
   * @returns Approval response or null on error
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
            body: JSON.stringify({ selectedSubtasks: selectedSubtaskIndices }),
          },
        );
        const data = await res.json();
        if (res.ok) {
          setAnalysisApprovalId(null);
          return data;
        }
        throw new Error(data.error || '承認に失敗しました');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [analysisApprovalId],
  );

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
    analysisResult,
    analysisApprovalId,
    sessions,
    error,
    analysisError,
    agentConfigId,
    agents,
    setConfig,
    setError,
    setAnalysisResult,
    setAgentConfigId,
    fetchConfig,
    enableDeveloperMode,
    disableDeveloperMode,
    updateConfig,
    analyzeTask,
    fetchSessions,
    approveSubtaskCreation,
    fetchAgents,
  };
}
