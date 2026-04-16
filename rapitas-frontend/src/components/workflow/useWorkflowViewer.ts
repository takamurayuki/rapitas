'use client';
// useWorkflowViewer

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type {
  WorkflowFileType,
  WorkflowStatus,
  WorkflowRole,
  WorkflowRoleConfig,
} from '@/types';
import { useWorkflowFiles } from '@/hooks/workflow/useWorkflowFiles';
import { useLocaleStore } from '@/stores/locale-store';
import { API_BASE_URL } from '@/utils/api';
import type { WorkflowMode } from './CompactWorkflowSelector';

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  research_done: 1,
  plan_created: 2,
  plan_approved: 3,
  in_progress: 4,
  verify_done: 5,
  completed: 6,
};

// Auto-selection mapping for tabs corresponding to status
const STATUS_TO_TAB: Partial<Record<WorkflowStatus, WorkflowFileType>> = {
  research_done: 'research',
  plan_created: 'plan',
  in_progress: 'plan',
  verify_done: 'verify',
  completed: 'verify',
};

export interface UseWorkflowViewerOptions {
  taskId: number;
  workflowStatus?: WorkflowStatus | null;
  workflowMode?: WorkflowMode | null;
  onStatusChange?: (newStatus: WorkflowStatus) => void;
  onWorkflowModeChange?: (mode: WorkflowMode, isOverride: boolean) => void;
  workflowModeOverride?: boolean;
}

/**
 * Manages all async state, polling, and derived values for WorkflowViewer.
 *
 * @param options - Configuration options for the workflow viewer state
 * @returns State and handler functions consumed by WorkflowViewer UI
 */
export function useWorkflowViewer({
  taskId,
  workflowStatus,
  workflowMode,
  onStatusChange,
  onWorkflowModeChange,
  workflowModeOverride,
}: UseWorkflowViewerOptions) {
  const [activeTab, setActiveTab] = useState<WorkflowFileType>('research');
  const locale = useLocaleStore((s) => s.locale);
  const {
    files,
    isLoading,
    error,
    refetch,
    workflowPath,
    workflowStatus: fetchedStatus,
  } = useWorkflowFiles(taskId);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [roles, setRoles] = useState<WorkflowRoleConfig[]>([]);
  const [autoComplexityAnalysis, setAutoComplexityAnalysis] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<WorkflowStatus | null>(null);
  const prevWorkflowStatusPropRef = useRef<WorkflowStatus | null | undefined>(
    workflowStatus,
  );
  const prevFetchedStatusRef = useRef<WorkflowStatus | null>(null);

  // Effective status: reflects prop updates immediately without waiting for fetch to catch up
  // Uses prop when it's ahead based on StatusOrder comparison
  const effectiveStatus = (() => {
    if (!fetchedStatus && !workflowStatus) return null;
    if (!fetchedStatus) return workflowStatus || null;
    if (!workflowStatus) return fetchedStatus;
    const propOrder = STATUS_ORDER[workflowStatus] ?? -1;
    const fetchOrder = STATUS_ORDER[fetchedStatus] ?? -1;
    return propOrder >= fetchOrder ? workflowStatus : fetchedStatus;
  })();

  // Notify parent when fetchedStatus changes
  useEffect(() => {
    if (fetchedStatus && fetchedStatus !== prevStatusRef.current) {
      prevStatusRef.current = fetchedStatus;
      if (onStatusChange && fetchedStatus !== workflowStatus) {
        onStatusChange(fetchedStatus);
      }
    }
  }, [fetchedStatus, workflowStatus, onStatusChange]);

  // Refetch when parent workflowStatus prop is updated
  useEffect(() => {
    if (
      workflowStatus &&
      workflowStatus !== prevWorkflowStatusPropRef.current
    ) {
      prevWorkflowStatusPropRef.current = workflowStatus;
      refetch();
    }
  }, [workflowStatus, refetch]);

  // Auto-switch tabs on status change
  useEffect(() => {
    if (effectiveStatus) {
      const tab = STATUS_TO_TAB[effectiveStatus];
      if (tab) {
        setActiveTab(tab);
      }
    }
  }, [effectiveStatus]);

  // Fetch role configuration
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow-roles`);
        if (res.ok) {
          setRoles(await res.json());
        }
      } catch {
        // ignore
      }
    };
    fetchRoles();
  }, []);

  // Fetch auto-complexity analysis settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (res.ok) {
          const data = await res.json();
          setAutoComplexityAnalysis(data.autoComplexityAnalysis ?? false);
        }
      } catch {
        // ignore
      }
    };
    fetchSettings();
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (intervalMs: number = 3000) => {
      stopPolling();
      pollingRef.current = setInterval(() => {
        refetch();
      }, intervalMs);
    },
    [refetch, stopPolling],
  );

  // Stop polling on component unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleAdvance = useCallback(async () => {
    setIsAdvancing(true);
    setAdvanceError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/workflow/tasks/${taskId}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: locale }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAdvanceError(data.error || 'フェーズの実行に失敗しました');
      } else if (data.async) {
        // Async execution: monitor state with polling
        startPolling(3000);
      } else {
        // Sync completion: refetch immediately
        await refetch();
      }
    } catch (err) {
      setAdvanceError(
        err instanceof Error ? err.message : 'エラーが発生しました',
      );
    } finally {
      setIsAdvancing(false);
    }
  }, [taskId, locale, refetch, startPolling]);

  // Stop polling and refetch when status reaches final state
  useEffect(() => {
    if (
      fetchedStatus &&
      fetchedStatus !== prevFetchedStatusRef.current &&
      pollingRef.current
    ) {
      prevFetchedStatusRef.current = fetchedStatus;
      // Stop polling when reaching final states (completed, verify_done)
      if (fetchedStatus === 'completed' || fetchedStatus === 'verify_done') {
        stopPolling();
      }
      refetch();
    }
    if (fetchedStatus && !prevFetchedStatusRef.current) {
      prevFetchedStatusRef.current = fetchedStatus;
    }
  }, [fetchedStatus, stopPolling, refetch]);

  // Start polling when plan_approved as backend will auto-advance
  useEffect(() => {
    if (effectiveStatus === 'plan_approved' && !pollingRef.current) {
      startPolling(3000);
    }
  }, [effectiveStatus, startPolling]);

  const activeFile = useMemo(() => {
    if (!files) return null;
    return files[activeTab];
  }, [files, activeTab]);

  const tabStatus = useMemo(() => {
    if (!files)
      return { research: false, question: false, plan: false, verify: false };
    return {
      research: files.research.exists,
      question: files.question.exists,
      plan: files.plan.exists,
      verify: files.verify.exists,
    };
  }, [files]);

  const isPolling = pollingRef.current !== null;

  /**
   * Callback passed to CompactWorkflowSelector when complexity analysis completes.
   * Notifies parent only when mode is not manually overridden.
   *
   * @param analysis - The completed analysis result containing recommendedMode
   */
  const handleAnalysisComplete = useCallback(
    (analysis: { recommendedMode: WorkflowMode }) => {
      if (onWorkflowModeChange && !workflowModeOverride) {
        onWorkflowModeChange(analysis.recommendedMode, false);
      }
    },
    [onWorkflowModeChange, workflowModeOverride],
  );

  return {
    activeTab,
    setActiveTab,
    files,
    isLoading,
    error,
    refetch,
    workflowPath,
    effectiveStatus,
    isAdvancing,
    advanceError,
    setAdvanceError,
    roles,
    autoComplexityAnalysis,
    isPolling,
    activeFile,
    tabStatus,
    handleAdvance,
    handleAnalysisComplete,
  };
}
