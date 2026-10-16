'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';

export interface UseWorkflowDisabledToggleResult {
  /** Task-level flag OR the global setting — what should actually gate execution. */
  effectiveWorkflowDisabled: boolean;
  /** Just the task-level flag, independent of the global setting. */
  taskLevelWorkflowDisabled: boolean;
  /** True when the global setting alone already forces the effective state on. */
  globallyForced: boolean;
  /** True once the task has left 'todo' — toggling is refused (server-enforced too). */
  isLocked: boolean;
  /** True while a toggle request is in flight. */
  isToggling: boolean;
  /** Flips the task-level flag via POST /workflow/tasks/:id/set-workflow-disabled. */
  toggle: () => Promise<void>;
}

/**
 * Manages the per-task "skip the multi-phase workflow" toggle: fetches the
 * global `UserSettings.workflowDisabledGlobally` flag, ORs it with the
 * task-level `Task.workflowDisabled` flag (mirrors the backend's
 * `resolveEffectiveWorkflowDisabled`), and exposes `toggle()` to flip the
 * task-level flag. Locked once the task has left 'todo', mirroring the
 * server-side lock in `handleSetWorkflowDisabled`.
 *
 * @param taskId - Task id, or null before the task has loaded. / タスクID
 * @param task - Current task (reads workflowDisabled/status). / 現在のタスク
 * @param setTask - Setter used to apply the toggled value optimistically. / タスク状態の更新関数
 */
export function useWorkflowDisabledToggle(
  taskId: number | null,
  task: Task | null,
  setTask: Dispatch<SetStateAction<Task | null>>,
): UseWorkflowDisabledToggleResult {
  const [globallyDisabled, setGloballyDisabled] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (!res.ok) return;
        const settings = await res.json();
        if (cancelled) return;
        setGloballyDisabled(!!settings.workflowDisabledGlobally);
      } catch {
        // Non-fatal — fall back to task-level only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const taskLevelWorkflowDisabled = !!task?.workflowDisabled;
  const effectiveWorkflowDisabled = taskLevelWorkflowDisabled || globallyDisabled;
  const isLocked = !!task && task.status !== 'todo';

  const toggle = async () => {
    if (!taskId || isLocked || isToggling) return;
    setIsToggling(true);
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/set-workflow-disabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !taskLevelWorkflowDisabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setTask((prev) => (prev ? { ...prev, workflowDisabled: data.workflowDisabled } : prev));
      }
    } catch {
      // Non-fatal — the toggle simply doesn't change; the user can retry.
    } finally {
      setIsToggling(false);
    }
  };

  return {
    effectiveWorkflowDisabled,
    taskLevelWorkflowDisabled,
    globallyForced: globallyDisabled,
    isLocked,
    isToggling,
    toggle,
  };
}
