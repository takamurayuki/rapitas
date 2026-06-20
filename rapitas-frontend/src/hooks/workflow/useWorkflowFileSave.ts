'use client';

import { useState, useCallback } from 'react';
import type { WorkflowFileType } from '@/types';
import { API_BASE_URL } from '@/utils/api';

/** Result of a workflow file save. */
interface SaveResult {
  success: boolean;
  workflowStatus?: string;
  error?: string;
}

/**
 * Hook to save (overwrite) a workflow markdown file via the workflow API.
 * Mirrors useWorkflowApproval's shape. Lets a human edit plan.md (or other
 * artifacts) in the UI before approving — the backend status guard still
 * rejects out-of-phase saves.
 *
 * @param taskId - The task whose workflow file is being saved. / 対象タスクID
 * @returns saveFile / isSaving / error / clearError
 */
export function useWorkflowFileSave(taskId: number) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveFile = useCallback(
    async (fileType: WorkflowFileType, content: string): Promise<SaveResult> => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/files/${fileType}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return { success: true, workflowStatus: data.workflowStatus };
      } catch (err) {
        const message = err instanceof Error ? err.message : '保存に失敗しました';
        setError(message);
        return { success: false, error: message };
      } finally {
        setIsSaving(false);
      }
    },
    [taskId],
  );

  const clearError = useCallback(() => setError(null), []);

  return { saveFile, isSaving, error, clearError };
}
