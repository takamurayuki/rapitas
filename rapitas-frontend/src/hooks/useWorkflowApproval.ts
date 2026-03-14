'use client';

import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';

export function useWorkflowApproval(
  taskId: number,
  onComplete?: (newStatus: string) => void,
) {
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approvePlan = useCallback(
    async (approved: boolean, reason?: string) => {
      setIsApproving(true);
      setError(null);

      try {
        const res = await fetch(
          `${API_BASE_URL}/workflow/tasks/${taskId}/approve-plan`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved, reason }),
          },
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const data = await res.json();

        if (data.success && onComplete) {
          onComplete(data.workflowStatus);
        }

        return { success: true, workflowStatus: data.workflowStatus };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : '承認処理に失敗しました';
        setError(message);
        return { success: false, error: message };
      } finally {
        setIsApproving(false);
      }
    },
    [taskId, onComplete],
  );

  const clearError = useCallback(() => setError(null), []);

  return { approvePlan, isApproving, error, clearError };
}
