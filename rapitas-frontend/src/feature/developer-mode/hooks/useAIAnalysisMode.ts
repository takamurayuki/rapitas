'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  AgentSession,
  ExecutionStatus,
  ExecutionResult,
} from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useAIAnalysisMode');

export type { ExecutionStatus, ExecutionResult };

export function useDeveloperMode(taskId: number) {
  const t = useTranslations('devMode.useAIAnalysisMode');
  const [config, setConfig] = useState<DeveloperModeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<TaskAnalysisResult | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/developer-mode/config/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      } else {
        setConfig(null);
      }
    } catch {
      setError(t('fetchConfigFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [taskId, t]);

  const enableDeveloperMode = useCallback(
    async (options?: { autoApprove?: boolean; maxSubtasks?: number; priority?: string }) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/developer-mode/enable/${taskId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options || {}),
        });
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          return data;
        } else {
          throw new Error(t('enableFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('genericError'));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId, t],
  );

  const disableDeveloperMode = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/developer-mode/disable/${taskId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setConfig(null);
        setAnalysisResult(null);
        return true;
      } else {
        throw new Error(t('disableFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('genericError'));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [taskId, t]);

  const updateConfig = useCallback(
    async (updates: Partial<DeveloperModeConfig>) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/developer-mode/config/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          return data;
        } else {
          throw new Error(t('updateFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('genericError'));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [taskId, t],
  );

  const analyzeTask = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/developer-mode/analyze/${taskId}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysisResult(data.analysis);
        return data;
      } else {
        throw new Error(data.error || t('analyzeFailed'));
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : t('genericError'));
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [taskId, t]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/developer-mode/sessions/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      logger.error('Failed to fetch sessions:', err);
    }
  }, [taskId]);

  /**
   * AIエージェントを実行してタスクを実装
   */
  const executeAgent = useCallback(
    async (options?: { instruction?: string; branchName?: string; workingDirectory?: string }) => {
      setIsExecuting(true);
      setExecutionStatus('running');
      setExecutionResult(null);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options || {}),
        });
        const data = await res.json();
        if (res.ok) {
          setExecutionResult({
            success: true,
            sessionId: data.sessionId,
            message: data.message || t('executionStarted'),
          });
          setExecutionStatus('completed');
          return data;
        } else {
          throw new Error(data.error || t('executeFailed'));
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : t('genericError');
        setError(errorMessage);
        setExecutionStatus('failed');
        setExecutionResult({
          success: false,
          error: errorMessage,
        });
        return null;
      } finally {
        setIsExecuting(false);
      }
    },
    [taskId, t],
  );

  /**
   * 実行状態をリセット
   */
  const resetExecutionState = useCallback(() => {
    setExecutionStatus('idle');
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
