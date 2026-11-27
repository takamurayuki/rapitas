/**
 * useSelectedTaskStatus
 *
 * Polls GET /tasks/:id for a non-head task so the strip can draw its phase;
 * activeTasks carries no workflow state. Not used for the head task.
 */
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

interface TaskStatus {
  workflowStatus: string | null;
  workflowMode: string | null;
}

const POLL_MS = 8000; // same cadence as useThemeAutoRun

/**
 * @param taskId - Task to watch, or null to do nothing / 取得対象
 * @returns Its latest status, or null before the first success / 最新の状態
 */
export function useSelectedTaskStatus(taskId: number | null): TaskStatus | null {
  const [result, setResult] = useState<(TaskStatus & { id: number }) | null>(null);

  useEffect(() => {
    if (taskId === null) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(API_BASE_URL + '/tasks/' + taskId, { signal: controller.signal });
        if (!res.ok) return;
        const json = await res.json();
        // 選択変更・アンマウント後に届いた応答は現在の成功値を上書きしない。
        if (controller.signal.aborted) return;
        setResult({
          id: taskId,
          workflowStatus: json.workflowStatus ?? null,
          workflowMode: json.workflowMode ?? null,
        });
      } catch {
        // keep the last good value; the next poll retries
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [taskId]);

  // A result for another task (selection changed) is never shown.
  return taskId !== null && result?.id === taskId ? result : null;
}
