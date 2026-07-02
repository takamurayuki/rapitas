'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { WorkflowFile, WorkflowFileType, WorkflowStatus, WorkflowPathInfo } from '@/types';
import { API_BASE_URL } from '@/utils/api';

export type WorkflowFilesData = {
  research: WorkflowFile;
  question: WorkflowFile;
  plan: WorkflowFile;
  verify: WorkflowFile;
};

export function useWorkflowFiles(taskId: number | null) {
  const t = useTranslations('common');
  const [files, setFiles] = useState<WorkflowFilesData | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [workflowPath, setWorkflowPath] = useState<WorkflowPathInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isInitialFetch = useRef(true);

  const fetchFiles = useCallback(async () => {
    if (!taskId) return;

    // NOTE: Show loading only on initial fetch (keep previous data during refetch)
    if (isInitialFetch.current) {
      setIsLoading(true);
    }
    setError(null);

    try {
      // no-store so polled refetches always get the agent's latest md writes
      // (never a cached response).
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/files`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setFiles({
        research: data.research,
        question: data.question,
        plan: data.plan,
        verify: data.verify,
      });
      setWorkflowStatus(data.workflowStatus || null);
      setWorkflowPath(data.path || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('useWorkflowFiles.fetchFailed'));
    } finally {
      setIsLoading(false);
      isInitialFetch.current = false;
    }
  }, [taskId, t]);

  // Reset to initial fetch when taskId changes
  useEffect(() => {
    isInitialFetch.current = true;
    setFiles(null);
    setWorkflowStatus(null);
    setWorkflowPath(null);
    fetchFiles();
  }, [fetchFiles]);

  const hasAnyFile = useMemo(() => {
    if (!files) return false;
    return (
      files.research.exists || files.question.exists || files.plan.exists || files.verify.exists
    );
  }, [files]);

  return {
    files,
    workflowStatus,
    workflowPath,
    isLoading,
    error,
    refetch: fetchFiles,
    hasAnyFile,
  };
}
