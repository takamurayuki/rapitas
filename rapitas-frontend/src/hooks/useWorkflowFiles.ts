'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { WorkflowFile, WorkflowFileType, WorkflowStatus, WorkflowPathInfo } from '@/types';
import { API_BASE_URL } from '@/utils/api';

export type WorkflowFilesData = {
  research: WorkflowFile;
  question: WorkflowFile;
  plan: WorkflowFile;
  verify: WorkflowFile;
};

export function useWorkflowFiles(taskId: number | null) {
  const [files, setFiles] = useState<WorkflowFilesData | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [workflowPath, setWorkflowPath] = useState<WorkflowPathInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isInitialFetch = useRef(true);

  const fetchFiles = useCallback(async () => {
    if (!taskId) return;

    // 初回取得時のみローディング表示（refetch時は前のデータを保持したまま更新）
    if (isInitialFetch.current) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/files`);
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
      setError(err instanceof Error ? err.message : 'ワークフローファイルの取得に失敗しました');
    } finally {
      setIsLoading(false);
      isInitialFetch.current = false;
    }
  }, [taskId]);

  // taskIdが変わった場合はinitial fetchに戻す
  useEffect(() => {
    isInitialFetch.current = true;
    setFiles(null);
    setWorkflowStatus(null);
    setWorkflowPath(null);
    fetchFiles();
  }, [fetchFiles]);

  const hasAnyFile = useMemo(() => {
    if (!files) return false;
    return files.research.exists || files.question.exists || files.plan.exists || files.verify.exists;
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
